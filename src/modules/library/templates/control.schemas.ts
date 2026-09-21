import { z } from 'zod'
import { LIMITS } from '../../../shared/limits.js'
import { optionalText } from '../../../shared/schemas.js'

const Title = z.string().trim().min(1).max(LIMITS.title)
/** La referencia es texto libre tal como la escribe la norma ("A.5.1", "APO01.01", "Art. 5"…); vacía = sin referencia. */
const Reference = optionalText(LIMITS.title).nullable()
const Description = optionalText().nullable()
const Position = z.int().min(0)

/**
 * Un control en la lista plana de la plantilla, en orden de lectura. `depth` (0 = dominio) e `isLeaf` los da el árbol
 * (`domain/control-tree.ts`): el frontend no reimplementa la jerarquía. Solo las hojas se evalúan.
 */
export const ControlView = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  reference: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.int(),
  depth: z.int(),
  isLeaf: z.boolean(),
})

export const CreateControl = z.object({
  /** Sin padre = un dominio (primer nivel). */
  parentId: z.uuid().nullish(),
  /** Lugar entre sus hermanos (0 = primero); sin valor, al final. */
  position: Position.optional(),
  reference: Reference.optional(),
  title: Title,
  description: Description.optional(),
})
export type CreateControlT = z.infer<typeof CreateControl>

export const UpdateControl = z
  .object({ reference: Reference, title: Title, description: Description })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Indica al menos un campo a modificar' })
export type UpdateControlT = z.infer<typeof UpdateControl>

/** Cambiar de padre y/o de lugar entre hermanos: subir y bajar es mover a otra posición. */
export const MoveControl = z.object({ parentId: z.uuid().nullable(), position: Position })
export type MoveControlT = z.infer<typeof MoveControl>

export const ControlId = z.uuid()
