import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { updateEvaluationContent } from '../../domain/evaluation.decider.js'
import { EvaluationStore } from '../../infrastructure/evaluation.store.js'
import type { UpdateEvaluationContentT } from '../evaluation.schemas.js'
import { toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class UpdateEvaluationUseCase {
  constructor(private readonly store: EvaluationStore) {}

  /**
   * El auditor asignado edita el contenido: nivel alcanzado, hallazgos, notas, o lo marca "no aplica". El primer envío
   * arranca el criterio (con su propio evento); después solo se edita en `IN_PROGRESS` y `RETURNED`. La versión es la
   * que mandó el cliente (`expectedVersion`, docs/06 §10) — el bloqueo optimista que expone la API, no el interno del
   * store para las revisiones.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: UpdateEvaluationContentT) {
    const { row, template } = await this.store.execute(
      actor,
      auditId,
      evaluationId,
      (s) => updateEvaluationContent(s, actor, input),
      { expectedVersion: input.version },
    )
    return toEvaluationViews([row], template)[0]!
  }
}
