import { meetsExpected } from './scoring.js'

/**
 * Qué se traslada a un seguimiento (docs/06 §9). Función PURA. Un criterio se traslada, sin volver a evaluarlo, si en la
 * auditoría anterior CUMPLIÓ lo esperado o no aplicaba, Y el líder no pidió explícitamente que se revisara de nuevo
 * (`requiresFollowUp`, docs/06 §3: el líder lo marca al aprobar — un criterio puede cumplir y aun así merecer otra
 * mirada). Lo que no cumplió, quedó sin nivel, o el líder marcó para revisar, se evalúa de nuevo.
 */
export interface PreviousResult {
  readonly isNotApplicable: boolean
  readonly expected: number | null
  readonly achieved: number | null
  readonly requiresFollowUp: boolean
}

export function carriesOver(previous: PreviousResult): boolean {
  if (previous.requiresFollowUp) return false
  if (previous.isNotApplicable) return true
  return previous.expected !== null && previous.achieved !== null && meetsExpected(previous.expected, previous.achieved)
}
