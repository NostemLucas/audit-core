import { z } from 'zod'
import { Instant } from '../../../platform/http/index.js'

/** Una entrada del historial: el texto ya redactado, quién y cuándo, y sobre qué trata. */
export const AuditEventView = z.object({
  id: z.uuid(),
  type: z.string(),
  message: z.string(),
  at: Instant,
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  subject: z.object({ type: z.string(), id: z.uuid() }),
})

/** La historia de UN criterio: además lleva el contenido del evento (p. ej. la copia de lo enviado a revisión, docs/06 §4). */
export const EvaluationHistoryEntry = AuditEventView.extend({ payload: z.record(z.string(), z.unknown()) })

export const ListHistoryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
export type ListHistoryQueryT = z.infer<typeof ListHistoryQuery>
