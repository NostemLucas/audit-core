import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { OrganizationsReader } from '../../../organizations/index.js'
import { formatAuditCode } from '../../domain/audit-code.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { loadAuditView } from '../../infrastructure/audit.queries.js'
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
   * Crea la auditoría en borrador, con quien la crea como su manager, y UNA evaluación por cada hoja de la plantilla (sin nivel
   * esperado todavía). Todo o nada: el historial se escribe en la misma transacción.
   */
  @Transactional()
  async execute(actor: Actor, input: CreateAuditT) {
    await this.organizations.getActive(input.organizationId)
    const template = await this.library.getUsableTemplate(input.templateId)
    const scale = await this.library.getActiveScale(input.scaleId)
    if (input.plannedStart && input.plannedEnd && input.plannedEnd < input.plannedStart) {
      throw new DomainError(AuditErrors.AUDIT_DATES_INVALID, {
        plannedStart: input.plannedStart,
        plannedEnd: input.plannedEnd,
      })
    }

    const code = await this.nextCode()
    const audit = await this.tx.audit.create({
      data: {
        code,
        name: input.name,
        introduction: input.introduction ?? null,
        scopeNotes: input.scopeNotes ?? null,
        objectives: input.objectives ?? null,
        templateId: input.templateId,
        organizationId: input.organizationId,
        scaleId: input.scaleId,
        managerId: actor.id,
        plannedStart: input.plannedStart ? new Date(input.plannedStart) : null,
        plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : null,
        scopeItems: { create: input.scopeItems.map((name) => ({ name })) },
      },
    })
    // El nivel esperado se fija según la dimensión de la escala (docs/06 §2): en conformidad, la norma no deja margen y se
    // espera el puntaje más alto sin que el líder tenga que hacer nada; en capacidad varía por criterio y lo fija el líder.
    const maxLevelId = scale.dimension === 'CONFORMITY' ? scale.levels.at(-1)!.id : null
    await this.tx.evaluation.createMany({
      data: template.tree
        .leaves()
        .map((leaf) => ({ auditId: audit.id, controlId: leaf.id, expectedLevelId: maxLevelId })),
    })
    await this.events.publish(AuditEvents.AuditCreated, { auditId: audit.id, code, name: audit.name })

    return withAccess(await loadAuditView(this.tx, audit.id), actor, { managerId: actor.id, memberRole: null })
  }

  /** `AUD-AAAA-NNNNN` desde la secuencia de la BD: dos altas simultáneas nunca comparten número. */
  private async nextCode(): Promise<string> {
    const [row] = await this.tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('audit_code_seq') AS n`
    return formatAuditCode(this.clock.now().getUTCFullYear(), Number(row!.n))
  }
}
