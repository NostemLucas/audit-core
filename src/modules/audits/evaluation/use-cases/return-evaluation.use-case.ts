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
export class ReturnEvaluationUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El LÍDER devuelve un criterio enviado, con comentario obligatorio. Vuelve a `RETURNED` (editable).
   * `loadAuditForUpdate` bloquea la fila de la auditoría en el MISMO orden que las demás transiciones (docs/06 §10):
   * no es solo por `CloseAudit` — hasta esta operación, que no toca el candado de cierre, necesita el mismo orden de
   * bloqueo, porque su propio `INSERT` en `audit_events` ya pide un `FOR KEY SHARE` sobre esa fila por la clave
   * foránea. Sin este candado ACÁ TAMBIÉN, dos transiciones distintas sobre el mismo criterio pueden bloquearse en
   * ciclo (una tiene la fila de la evaluación y quiere la de la auditoría; la otra al revés) — confirmado con un
   * deadlock real de Postgres al agregar el candado solo en algunas transiciones y no en todas.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: ReturnEvaluationT) {
    const audit = await loadAuditForUpdate(this.tx, auditId)
    assertAuditEvaluable(audit.status)
    assertOnAudit('lead', actor, await accessOf(this.tx, actor, audit))
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)

    await transitionEvaluation(this.tx, evaluationId, evaluation.status, 'RETURN')
    const template = await this.library.getTemplate(audit.templateId)
    await this.events.publish(AuditEvents.EvaluationReturned, {
      auditId,
      evaluationId,
      controlTitle: template.tree.pathTo(evaluation.controlId).at(-1)!.title,
      comments: input.comments,
    })
    return toEvaluationViews([await loadEvaluation(this.tx, auditId, evaluationId)], template)[0]!
  }
}
