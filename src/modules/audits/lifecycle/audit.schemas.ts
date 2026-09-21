import { z } from 'zod'
import { CalendarDate, Instant } from '../../../platform/http/index.js'
import { AuditStatus, ScaleDimension } from '../../../shared/enums.js'
import { LIMITS } from '../../../shared/limits.js'
import { optionalText } from '../../../shared/schemas.js'
import { AUDIT_EVENTS } from '../domain/audit.lifecycle.js'

const Name = z.string().trim().min(1).max(LIMITS.name)
const Text = optionalText().nullable()
const Day = z.iso.date()

// ── Salida ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const AuditView = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  introduction: z.string().nullable(),
  scopeNotes: z.string().nullable(),
  objectives: z.string().nullable(),
  status: z.enum(AuditStatus),
  /** Lo que el ciclo de vida permite hacer ahora Y lo que el actor puede hacer sobre ESTA auditoría (docs/03 §2.3, regla 12). */
  allowedActions: z.array(z.enum(AUDIT_EVENTS)),
  /** Permisos contextuales del actor (docs/06 §1), para pintar la interfaz sin reimplementar reglas. */
  permissions: z.object({ manage: z.boolean(), lead: z.boolean() }),
  plannedStart: CalendarDate.nullable(),
  plannedEnd: CalendarDate.nullable(),
  closedAt: Instant.nullable(),
  parentAuditId: z.uuid().nullable(),
  followUpNumber: z.int(),
  organization: z.object({ id: z.uuid(), name: z.string() }),
  template: z.object({ id: z.uuid(), name: z.string() }),
  scale: z.object({ id: z.uuid(), name: z.string(), dimension: z.enum(ScaleDimension) }),
  manager: z.object({ id: z.uuid(), name: z.string() }),
  scopeItems: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** Cuántos criterios (hojas de la plantilla) se evalúan. */
  evaluationCount: z.int(),
  createdAt: Instant,
  updatedAt: Instant,
})

// ── Entrada ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Crear una auditoría. La plantilla, la organización y la escala se eligen aquí y NO se cambian después (docs/06 §2): las
 * evaluaciones se crean con la auditoría, una por hoja de la plantilla.
 */
export const CreateAudit = z.object({
  name: Name,
  introduction: Text.optional(),
  scopeNotes: Text.optional(),
  objectives: Text.optional(),
  templateId: z.uuid(),
  organizationId: z.uuid(),
  scaleId: z.uuid(),
  plannedStart: Day.optional(),
  plannedEnd: Day.optional(),
  /** Qué se audita (un sistema, una sede, un proceso…). Sin elementos = toda la organización. */
  scopeItems: z
    .array(Name)
    .max(LIMITS.scopeItems)
    .default([])
    .refine((names) => new Set(names).size === names.length, { message: 'Hay elementos de alcance repetidos' }),
})
export type CreateAuditT = z.infer<typeof CreateAudit>

export const UpdateAudit = z
  .object({
    name: Name,
    introduction: Text,
    scopeNotes: Text,
    objectives: Text,
    plannedStart: Day.nullable(),
    plannedEnd: Day.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Indica al menos un campo a modificar' })
export type UpdateAuditT = z.infer<typeof UpdateAudit>

export const ListAuditsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Busca por nombre o código, sin distinguir mayúsculas. */
  q: z.string().trim().min(1).max(LIMITS.name).optional(),
  status: z.enum(AuditStatus).optional(),
  organizationId: z.uuid().optional(),
  /** Solo las auditorías donde soy el manager o miembro del equipo (un GERENTE o ADMIN las ve todas si no lo pide). */
  mine: z.stringbool().optional(),
})
export type ListAuditsQueryT = z.infer<typeof ListAuditsQuery>

export const AuditId = z.uuid()
