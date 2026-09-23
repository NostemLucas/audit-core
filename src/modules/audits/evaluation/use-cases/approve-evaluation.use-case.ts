import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { transitionEvaluation } from '../../infrastructure/evaluation-transitions.js'
import type { ApproveEvaluationT } from '../evaluation.schemas.js'
import { loadEvaluation, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class ApproveEvaluationUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /** El LÍDER aprueba un criterio enviado. Comentario opcional. */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: ApproveEvaluationT) {
    const audit = await loadAudit(this.tx, auditId)
    assertAuditEvaluable(audit.status)
    assertOnAudit('lead', actor, await accessOf(this.tx, actor, audit))
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)

    const requiresFollowUp = input.requiresFollowUp ?? false
    await transitionEvaluation(this.tx, evaluationId, evaluation.status, 'APPROVE', { requiresFollowUp })
    const template = await this.library.getTemplate(audit.templateId)
    await this.events.publish(AuditEvents.EvaluationApproved, {
      auditId,
      evaluationId,
      controlTitle: template.tree.pathTo(evaluation.controlId).at(-1)!.title,
      comments: input.comments ?? null,
      requiresFollowUp,
    })
    return toEvaluationViews([await loadEvaluation(this.tx, auditId, evaluationId)], template)[0]!
  }
}
