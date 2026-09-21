import { defineLifecycle } from '../../../platform/state/index.js'
import { EvaluationStatus } from '../../../shared/enums.js'
import { AuditErrors } from './errors.js'

/**
 * Ciclo de vida del criterio (evaluación) — docs/03 §2.4 y docs/06 §3. Única definición de sus estados y capacidades:
 *  - `editable`: se edita el contenido (nivel alcanzado, hallazgos, notas); solo en IN_PROGRESS y RETURNED.
 *  - `reassignable`: el líder puede cambiar su responsable; no cuando ya está enviado a revisión o aprobado.
 *  - `awaitingReview`: enviado, espera al líder.
 *  - `locked`: aprobado; no se toca salvo que el líder lo reabra (con comentario).
 */
type EvaluationEvent = 'START' | 'COMPLETE' | 'APPROVE' | 'RETURN' | 'REOPEN'
type EvaluationTag = 'editable' | 'reassignable' | 'awaitingReview' | 'locked'

export const evaluationLifecycle = defineLifecycle<EvaluationStatus, EvaluationEvent, EvaluationTag>({
  entity: 'EVALUATION',
  invalidState: AuditErrors.EVALUATION_INVALID_STATE,
  states: {
    NOT_STARTED: { on: { START: 'IN_PROGRESS' }, tags: ['reassignable'] },
    IN_PROGRESS: { on: { COMPLETE: 'COMPLETED' }, tags: ['editable', 'reassignable'] },
    COMPLETED: { on: { APPROVE: 'APPROVED', RETURN: 'RETURNED' }, tags: ['awaitingReview'] },
    RETURNED: { on: { COMPLETE: 'COMPLETED' }, tags: ['editable', 'reassignable'] },
    APPROVED: { on: { REOPEN: 'RETURNED' }, tags: ['locked'] },
  },
})

/** ¿Se puede cambiar el responsable de un criterio en este estado? */
export function isReassignable(status: EvaluationStatus): boolean {
  return evaluationLifecycle.has(status, 'reassignable')
}
