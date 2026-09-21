import { meetsExpected } from './scoring.js'

/**
 * Qué se traslada a un seguimiento (docs/06 §9). Función PURA. Un criterio se traslada, sin volver a evaluarlo, si en la
 * auditoría anterior CUMPLIÓ lo esperado o no aplicaba. Lo que no cumplió (o quedó sin nivel) se evalúa de nuevo.
 */
export interface PreviousResult {
  readonly isNotApplicable: boolean
  readonly expected: number | null
  readonly achieved: number | null
}

export function carriesOver(previous: PreviousResult): boolean {
  if (previous.isNotApplicable) return true
  return previous.expected !== null && previous.achieved !== null && meetsExpected(previous.expected, previous.achieved)
}
