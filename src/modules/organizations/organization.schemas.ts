import { z } from 'zod'
import { LIMITS } from '../../shared/limits.js'

/**
 * Esquema base del recurso: de aquí se derivan el de creación, el de edición y la vista. Un campo nuevo se agrega
 * aquí (y en `schema.prisma`); el resto sale solo.
 */
const Name = z.string().trim().min(1).max(LIMITS.name)

export const OrganizationView = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type OrganizationViewT = z.infer<typeof OrganizationView>

export const CreateOrganization = z.object({ name: Name })
export type CreateOrganizationT = z.infer<typeof CreateOrganization>

/** La disponibilidad no se edita aquí: tiene sus propios endpoints (docs/03 §3). */
export const UpdateOrganization = z.object({ name: Name })
export type UpdateOrganizationT = z.infer<typeof UpdateOrganization>

export const ListOrganizationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Busca por nombre, sin distinguir mayúsculas. */
  q: z.string().trim().min(1).max(LIMITS.name).optional(),
  /** `true` para los selectores (solo las elegibles para auditorías nuevas); sin valor, todas. */
  active: z.stringbool().optional(),
})
export type ListOrganizationsQueryT = z.infer<typeof ListOrganizationsQuery>

export const OrganizationId = z.uuid()
