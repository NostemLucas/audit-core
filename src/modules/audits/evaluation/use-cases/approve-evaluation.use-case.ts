import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { approveEvaluation } from '../../domain/evaluation.decider.js'
import { EvaluationStore } from '../../infrastructure/evaluation.store.js'
import type { ApproveEvaluationT } from '../evaluation.schemas.js'
import { toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class ApproveEvaluationUseCase {
  constructor(private readonly store: EvaluationStore) {}

  /** El LÍDER aprueba un criterio enviado. Comentario opcional. */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: ApproveEvaluationT) {
    const { row, template } = await this.store.execute(actor, auditId, evaluationId, (s) =>
      approveEvaluation(s, actor, {
        comments: input.comments ?? null,
        requiresFollowUp: input.requiresFollowUp ?? false,
      }),
    )
    return toEvaluationViews([row], template)[0]!
  }
}
