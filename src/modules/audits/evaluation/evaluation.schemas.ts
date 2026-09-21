import { z } from 'zod'
import { DecimalNumber } from '../../../platform/http/index.js'
import { EvaluationStatus } from '../../../shared/enums.js'
import { LIMITS } from '../../../shared/limits.js'
import { optionalText } from '../../../shared/schemas.js'

/**
 * Un criterio de la auditoría (una hoja de la plantilla) en la lista plana, en orden de lectura. `control` da el contexto sin
 * que el cliente recorra el árbol: la referencia, el criterio (título) y su dominio (el primer nivel).
 */
export const EvaluationView = z.object({
  id: z.uuid(),
  control: z.object({ id: z.uuid(), reference: z.string().nullable(), title: z.string(), domain: z.string() }),
  status: z.enum(EvaluationStatus),
  assignedUser: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  expectedLevel: z.object({ id: z.uuid(), value: DecimalNumber, label: z.string() }).nullable(),
  guidance: z.string().nullable(),
})

export const ListEvaluationsQuery = z.object({
  /** Los criterios de un auditor. */
  assignedTo: z.uuid().optional(),
  /** Solo los que nadie tiene asignados. */
  unassigned: z.stringbool().optional(),
  status: z.enum(EvaluationStatus).optional(),
})
export type ListEvaluationsQueryT = z.infer<typeof ListEvaluationsQuery>

/** Asignar varios criterios a un auditor; `userId: null` los deja sin asignar. Idempotente. */
export const AssignEvaluations = z.object({
  evaluationIds: z.array(z.uuid()).min(1).max(LIMITS.assignBatch),
  userId: z.uuid().nullable(),
})
export type AssignEvaluationsT = z.infer<typeof AssignEvaluations>

/**
 * Fijar el nivel esperado de uno o varios criterios (el líder, uno a uno o en bloque, docs/06 §3). `guidance` es opcional: si
 * no se envía, no se toca; enviarlo vacío lo borra.
 */
export const SetExpectedLevel = z.object({
  evaluationIds: z.array(z.uuid()).min(1).max(LIMITS.assignBatch),
  expectedLevelId: z.uuid(),
  guidance: optionalText().optional(),
})
export type SetExpectedLevelT = z.infer<typeof SetExpectedLevel>
