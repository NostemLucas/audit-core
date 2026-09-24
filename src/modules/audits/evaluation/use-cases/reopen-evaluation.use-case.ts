import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAuditForUpdate } from '../../infrastructure/audit.queries.js'
import { transitionEvaluation } from '../../infrastructure/evaluation-transitions.js'
import type { ReturnEvaluationT } from '../evaluation.schemas.js'
import { loadEvaluation, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class ReopenEvaluationUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El LÍDER reabre un criterio ya aprobado, con comentario obligatorio. Excepcional: vuelve a `RETURNED`.
   * `loadAuditForUpdate` bloquea la fila de la auditoría (docs/06 §10), en el MISMO orden que toda transición de
   * evaluación: serializa esto contra `CloseAudit` (sin este candado, un reabrir podía colarse mientras se decidía
   * si la auditoría podía cerrar, dejándola CERRADA con este criterio ya no aprobado — confirmado con una prueba de
   * concurrencia real) y evita un deadlock con las demás transiciones (mismo motivo que `approve-evaluation`).
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: ReturnEvaluationT) {
    const audit = await loadAuditForUpdate(this.tx, auditId)
    assertAuditEvaluable(audit.status)
    assertOnAudit('lead', actor, await accessOf(this.tx, actor, audit))
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)

    // Reabrir un criterio trasladado lo vuelve a evaluar AQUÍ: deja de ser un traslado (docs/06 §9).
    await transitionEvaluation(this.tx, evaluationId, evaluation.status, 'REOPEN', { carriedFromId: null })
    const template = await this.library.getTemplate(audit.templateId)
    await this.events.publish(AuditEvents.EvaluationReopened, {
      auditId,
      evaluationId,
      controlTitle: template.tree.pathTo(evaluation.controlId).at(-1)!.title,
      comments: input.comments,
    })
    return toEvaluationViews([await loadEvaluation(this.tx, auditId, evaluationId)], template)[0]!
  }
}
