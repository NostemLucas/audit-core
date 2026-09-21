import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditStaffable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { isReassignable } from '../../domain/evaluation.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import type { SetExpectedLevelT } from '../evaluation.schemas.js'
import { EVALUATION_INCLUDE, findEvaluations, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class SetExpectedLevelUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El LÍDER fija el nivel esperado (y su guía) de uno o varios criterios. En una escala CONFORMITY ya viene fijado al crear la
   * auditoría (docs/06 §2); esto sirve para la excepción documentada o para toda escala MATURITY. Todo o nada: si alguno ya está
   * enviado a revisión o aprobado, no se cambia ninguno (cambiar el objetivo después invalidaría lo ya evaluado). Idempotente:
   * el mismo nivel sin cambiar la guía no deja rastro.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, input: SetExpectedLevelT) {
    const audit = await loadAudit(this.tx, auditId)
    assertOnAudit('lead', actor, await accessOf(this.tx, actor, audit))
    assertAuditStaffable(audit.status)

    const scale = await this.library.getScale(audit.scaleId)
    const level = scale.levels.find((candidate) => candidate.id === input.expectedLevelId)
    if (!level) throw new DomainError(AuditErrors.EVALUATION_LEVEL_NOT_IN_SCALE, { levelId: input.expectedLevelId })

    const ids = [...new Set(input.evaluationIds)]
    const rows = await findEvaluations(this.tx, auditId, { id: { in: ids } })
    const found = new Set(rows.map((row) => row.id))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length > 0) throw new DomainError(AuditErrors.EVALUATION_NOT_FOUND, { evaluationIds: missing })

    const changing = rows.filter(
      (row) =>
        row.expectedLevelId !== input.expectedLevelId ||
        (input.guidance !== undefined && row.guidance !== input.guidance),
    )
    const blocked = changing.filter((row) => !isReassignable(row.status))
    if (blocked.length > 0) {
      throw new DomainError(AuditErrors.EVALUATION_EXPECTED_LEVEL_LOCKED, {
        evaluationIds: blocked.map((row) => row.id),
      })
    }
    if (changing.length === 0) return []

    await this.tx.evaluation.updateMany({
      where: { auditId, id: { in: changing.map((row) => row.id) } },
      data: {
        expectedLevelId: input.expectedLevelId,
        ...(input.guidance !== undefined && { guidance: input.guidance }),
      },
    })

    const template = await this.library.getTemplate(audit.templateId)
    for (const row of changing) {
      await this.events.publish(AuditEvents.EvaluationExpectedLevelSet, {
        auditId,
        evaluationId: row.id,
        controlTitle: template.tree.pathTo(row.controlId).at(-1)!.title,
        levelLabel: level.label,
        previousLevelLabel: row.expectedLevel?.label ?? null,
      })
    }
    return toEvaluationViews(
      await this.tx.evaluation.findMany({
        where: { auditId, id: { in: changing.map((row) => row.id) } },
        include: EVALUATION_INCLUDE,
      }),
      template,
    )
  }
}
