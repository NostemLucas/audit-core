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
  achievedLevel: z.object({ id: z.uuid(), value: DecimalNumber, label: z.string() }).nullable(),
  findings: z.string().nullable(),
  notes: z.string().nullable(),
  isNotApplicable: z.boolean(),
  notApplicableReason: z.string().nullable(),
  /** Cuántas evidencias tiene adjuntas (la Fase 4 trae el detalle; aquí solo el conteo, para saber si puede enviarse). */
  evidenceCount: z.int(),
  /** Seguimiento: el criterio de la auditoría anterior del que viene este resultado (trasladado, no evaluado aquí). Su historia se pide con el endpoint del criterio, en esa auditoría. */
  carriedFromId: z.uuid().nullable(),
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

/**
 * Editar el contenido de un criterio (el auditor asignado, docs/06 §3). No aplica y nivel alcanzado son excluyentes: no se
 * puede marcar "no aplica" y fijar un nivel a la vez en el mismo envío.
 */
export const UpdateEvaluationContent = z
  .object({
    achievedLevelId: z.uuid().nullable().optional(),
    findings: optionalText().nullable().optional(),
    notes: optionalText().nullable().optional(),
    isNotApplicable: z.boolean().optional(),
    notApplicableReason: optionalText().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Indica al menos un campo a modificar' })
  .refine((body) => !(body.isNotApplicable === true && body.achievedLevelId), {
    message: 'No se puede marcar "no aplica" y fijar un nivel alcanzado a la vez',
  })
export type UpdateEvaluationContentT = z.infer<typeof UpdateEvaluationContent>

/** Aprobar: el comentario es opcional. Devolver y reabrir: obligatorio (docs/06 §3). */
export const ApproveEvaluation = z.object({ comments: optionalText().optional() })
export type ApproveEvaluationT = z.infer<typeof ApproveEvaluation>

export const ReturnEvaluation = z.object({ comments: z.string().trim().min(1).max(LIMITS.text) })
export type ReturnEvaluationT = z.infer<typeof ReturnEvaluation>

export const EvaluationId = z.uuid()
