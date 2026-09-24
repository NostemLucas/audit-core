import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { returnEvaluation } from '../../domain/evaluation.decider.js'
import { EvaluationStore } from '../../infrastructure/evaluation.store.js'
import type { ReturnEvaluationT } from '../evaluation.schemas.js'
import { toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class ReturnEvaluationUseCase {
  constructor(private readonly store: EvaluationStore) {}

  /** El LÍDER devuelve un criterio enviado, con comentario obligatorio. Vuelve a `RETURNED` (editable). */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: ReturnEvaluationT) {
    const { row, template } = await this.store.execute(actor, auditId, evaluationId, (s) =>
      returnEvaluation(s, actor, input),
    )
    return toEvaluationViews([row], template)[0]!
  }
}
