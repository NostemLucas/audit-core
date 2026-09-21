import { z } from 'zod'
import { DecimalNumber, Instant } from '../../../platform/http/index.js'
import { ScaleDimension } from '../../../shared/enums.js'
import { LIMITS } from '../../../shared/limits.js'
import { optionalText } from '../../../shared/schemas.js'

const Name = z.string().trim().min(1).max(LIMITS.name)
const Label = z.string().trim().min(1).max(LIMITS.title)
const Description = optionalText()
/** Puntaje de una opción: columna Decimal(5,2), no negativo (CHECK en la BD). */
const Points = z.number().min(0).max(999.99).multipleOf(0.01)

// ── Salida ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const ScaleLevelView = z.object({
  id: z.uuid(),
  value: DecimalNumber,
  label: z.string(),
  description: z.string().nullable(),
})

export const ScaleView = z.object({
  id: z.uuid(),
  name: z.string(),
  dimension: z.enum(ScaleDimension),
  isActive: z.boolean(),
  /** Ordenadas por puntaje ascendente. */
  levels: z.array(ScaleLevelView),
  createdAt: Instant,
  updatedAt: Instant,
})

// ── Entrada ────────────────────────────────────────────────────────────────────────────────────────────────────
const LevelInput = z.object({ value: Points, label: Label, description: Description.optional() })

/**
 * Sin `.min(2)` en `levels`: el mínimo es una invariante de la escala y vive en `scale.rules.ts` (así el cliente recibe
 * `SCALE_LEVELS_INVALID` con `details.rule`, igual para crear que para quitar una opción). Aquí solo un tope contra abusos.
 */
export const CreateScale = z.object({
  name: Name,
  dimension: z.enum(ScaleDimension),
  levels: z.array(LevelInput).max(LIMITS.scaleLevels),
})
export type CreateScaleT = z.infer<typeof CreateScale>

/** La dimensión no se edita (docs/01 §2.2) y la disponibilidad tiene sus propios endpoints. */
export const UpdateScale = z.object({ name: Name })
export type UpdateScaleT = z.infer<typeof UpdateScale>

export const AddScaleLevel = LevelInput
export type AddScaleLevelT = z.infer<typeof AddScaleLevel>

export const UpdateScaleLevel = z
  .object({ value: Points, label: Label, description: Description.nullable() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Indica al menos un campo a modificar' })
export type UpdateScaleLevelT = z.infer<typeof UpdateScaleLevel>

export const ListScalesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(LIMITS.name).optional(),
  /** `true` para los selectores (solo las elegibles para auditorías nuevas). */
  active: z.stringbool().optional(),
})
export type ListScalesQueryT = z.infer<typeof ListScalesQuery>

export const ScaleId = z.uuid()
export const ScaleLevelId = z.uuid()
