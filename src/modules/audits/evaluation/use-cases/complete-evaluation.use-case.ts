import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { completeEvaluation } from '../../domain/evaluation.decider.js'
import { EvaluationStore } from '../../infrastructure/evaluation.store.js'
import { toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class CompleteEvaluationUseCase {
  constructor(private readonly store: EvaluationStore) {}

  /** El auditor asignado envía el criterio a revisión; el evento guarda una copia de lo enviado (docs/06 §4). */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const { row, template } = await this.store.execute(actor, auditId, evaluationId, (s) =>
      completeEvaluation(s, actor),
    )
    return toEvaluationViews([row], template)[0]!
  }
}
