import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { reopenEvaluation } from '../../domain/evaluation.decider.js'
import { EvaluationStore } from '../../infrastructure/evaluation.store.js'
import type { ReturnEvaluationT } from '../evaluation.schemas.js'
import { toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class ReopenEvaluationUseCase {
  constructor(private readonly store: EvaluationStore) {}

  /** El LÍDER reabre un criterio ya aprobado, con comentario obligatorio. Excepcional: vuelve a `RETURNED`. */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: ReturnEvaluationT) {
    const { row, template } = await this.store.execute(actor, auditId, evaluationId, (s) =>
      reopenEvaluation(s, actor, input),
    )
    return toEvaluationViews([row], template)[0]!
  }
}
