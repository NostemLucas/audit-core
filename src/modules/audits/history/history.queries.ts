import { renderEventMessage } from '../../../platform/events/index.js'

export const EVENT_INCLUDE = { actor: { select: { id: true, name: true } } } as const

interface EventRow {
  id: string
  type: string
  payload: unknown
  createdAt: Date
  subjectType: string
  subjectId: string
  actor: { id: string; name: string } | null
}

/**
 * Una fila de `audit_events` como se muestra. El texto se redacta AL LEER (docs/02 §6): si el evento ya no existe o su
 * payload no cumple el esquema actual, se muestra el tipo en lugar de romper el historial.
 */
export function toEventView(row: EventRow) {
  return {
    id: row.id,
    type: row.type,
    message: renderEventMessage(row.type, row.payload) ?? row.type,
    at: row.createdAt,
    actor: row.actor,
    subject: { type: row.subjectType, id: row.subjectId },
  }
}
