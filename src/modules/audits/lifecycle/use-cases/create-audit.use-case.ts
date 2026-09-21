import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { OrganizationsReader } from '../../../organizations/index.js'
import { formatAuditCode } from '../../domain/audit-code.js'
import { auditLifecycle } from '../../domain/audit.lifecycle.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { carriesOver } from '../../domain/follow-up.js'
import { loadAudit, loadAuditView } from '../../infrastructure/audit.queries.js'
import { withAccess } from '../audit.presenter.js'
import type { CreateAuditT } from '../audit.schemas.js'

@Injectable()
export class CreateAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly organizations: OrganizationsReader,
    private readonly library: LibraryReader,
  ) {}

  /**
   * Crea la auditoría en borrador, con quien la crea como su manager, y UNA evaluación por cada hoja de la plantilla. Todo o
   * nada: el historial se escribe en la misma transacción.
   *
   * Un seguimiento (`previousAuditId`) es esta misma auditoría con un enlace (docs/06 §9): toma plantilla, escala y organización
   * de la anterior y, salvo `carryOver: false`, traslada ya aprobado lo que allí cumplió.
   */
  @Transactional()
  async execute(actor: Actor, input: CreateAuditT) {
    const previous = input.previousAuditId ? await this.loadPrevious(input.previousAuditId) : null
    // El esquema garantiza que, sin `previousAuditId`, los tres ids vienen.
    const organizationId = previous?.organizationId ?? input.organizationId!
    const templateId = previous?.templateId ?? input.templateId!
    const scaleId = previous?.scaleId ?? input.scaleId!

    await this.organizations.getActive(organizationId)
    // Un seguimiento conserva la plantilla y la escala aunque después se hayan archivado o desactivado: es la misma medición.
    const template = previous
      ? await this.library.getTemplate(templateId)
      : await this.library.getUsableTemplate(templateId)
    const scale = previous ? await this.library.getScale(scaleId) : await this.library.getActiveScale(scaleId)
    if (input.plannedStart && input.plannedEnd && input.plannedEnd < input.plannedStart) {
      throw new DomainError(AuditErrors.AUDIT_DATES_INVALID, {
        plannedStart: input.plannedStart,
        plannedEnd: input.plannedEnd,
      })
    }

    // El nivel esperado se fija según la dimensión de la escala (docs/06 §2): en conformidad, la norma no deja margen y se
    // espera el puntaje más alto sin que el líder tenga que hacer nada; en capacidad varía por criterio y lo fija el líder.
    const defaultLevelId = scale.dimension === 'CONFORMITY' ? scale.levels.at(-1)!.id : null
    const leafIds = template.tree.leaves().map((leaf) => leaf.id)
    const evaluations = previous
      ? await this.followUpEvaluations(previous.id, leafIds, input.carryOver ?? true, defaultLevelId)
      : leafIds.map((controlId) => ({ controlId, expectedLevelId: defaultLevelId }))
    const carriedOver = evaluations.filter((evaluation) => 'carriedFromId' in evaluation).length

    const scopeItems = await this.scopeFor(previous?.id ?? null, input.scopeItems, carriedOver)
    const code = await this.nextCode()
    const audit = await this.tx.audit.create({
      data: {
        code,
        name: input.name,
        introduction: input.introduction ?? null,
        scopeNotes: input.scopeNotes ?? null,
        objectives: input.objectives ?? null,
        templateId,
        organizationId,
        scaleId,
        managerId: actor.id,
        previousAuditId: previous?.id ?? null,
        plannedStart: input.plannedStart ? new Date(input.plannedStart) : null,
        plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : null,
        scopeItems: { create: scopeItems.map((name) => ({ name })) },
      },
    })
    await this.tx.evaluation.createMany({
      data: evaluations.map((evaluation) => ({ auditId: audit.id, ...evaluation })),
    })
    await this.events.publish(AuditEvents.AuditCreated, {
      auditId: audit.id,
      code,
      name: audit.name,
      ...(previous && { previousAuditCode: previous.code, carriedOver }),
    })

    return withAccess(await loadAuditView(this.tx, audit.id), actor, { managerId: actor.id, memberRole: null })
  }

  /** La auditoría anterior: debe poder tomarse de referencia (cerrada o archivada). Quien crea es GERENTE y ve todas. */
  private async loadPrevious(id: string) {
    const previous = await loadAudit(this.tx, id)
    auditLifecycle.assert(previous.status, 'followable', AuditErrors.AUDIT_CANNOT_FOLLOW_UP)
    return previous
  }

  /**
   * Las evaluaciones de un seguimiento. Cada criterio hereda el nivel esperado y la guía de la anterior (el líder no empieza de
   * cero); y si `carryOver` y allí cumplió o no aplicaba, nace APROBADO con ese resultado y apuntando a él (`carriedFromId`).
   */
  private async followUpEvaluations(
    previousAuditId: string,
    leafIds: readonly string[],
    carryOver: boolean,
    defaultLevelId: string | null,
  ) {
    const rows = await this.tx.evaluation.findMany({
      where: { auditId: previousAuditId },
      include: { expectedLevel: { select: { value: true } }, achievedLevel: { select: { value: true } } },
    })
    const byControl = new Map(rows.map((row) => [row.controlId, row] as const))
    return leafIds.map((controlId) => {
      const before = byControl.get(controlId)
      const base = {
        controlId,
        expectedLevelId: before?.expectedLevelId ?? defaultLevelId,
        guidance: before?.guidance ?? null,
      }
      const traslada =
        carryOver &&
        before !== undefined &&
        carriesOver({
          isNotApplicable: before.isNotApplicable,
          expected: before.expectedLevel?.value.toNumber() ?? null,
          achieved: before.achievedLevel?.value.toNumber() ?? null,
        })
      if (!traslada) return base
      return {
        ...base,
        status: 'APPROVED' as const,
        achievedLevelId: before.achievedLevelId,
        findings: before.findings,
        notes: before.notes,
        isNotApplicable: before.isNotApplicable,
        notApplicableReason: before.notApplicableReason,
        carriedFromId: before.id,
      }
    })
  }

  /**
   * El alcance. Sin seguimiento, el que se indica. En un seguimiento se copia el de la anterior; si se trasladan criterios no
   * se puede cambiar (lo trasladado vale para ESE alcance, docs/06 §9), y si no se traslada ninguno se puede indicar otro.
   */
  private async scopeFor(previousAuditId: string | null, requested: readonly string[], carriedOver: number) {
    if (previousAuditId === null) return requested
    if (carriedOver > 0 && requested.length > 0)
      throw new DomainError(AuditErrors.AUDIT_SCOPE_INHERITED, { previousAuditId })
    if (requested.length > 0) return requested
    const inherited = await this.tx.auditScopeItem.findMany({
      where: { auditId: previousAuditId },
      select: { name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return inherited.map((item) => item.name)
  }

  /** `AUD-AAAA-NNNNN` desde la secuencia de la BD: dos altas simultáneas nunca comparten número. */
  private async nextCode(): Promise<string> {
    const [row] = await this.tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('audit_code_seq') AS n`
    return formatAuditCode(this.clock.now().getUTCFullYear(), Number(row!.n))
  }
}
