import { z } from 'zod'
import { Role } from '../../shared/enums.js'
import { LIMITS } from '../../shared/limits.js'

/** Un usuario del directorio: espejo de Authentik, solo lo que otros módulos y el frontend necesitan. */
export const UserView = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string(),
  email: z.string(),
  roles: z.array(z.enum(Role)),
})

export const ListUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Busca por nombre, usuario o correo, sin distinguir mayúsculas. */
  q: z.string().trim().min(1).max(LIMITS.name).optional(),
  role: z.enum(Role).optional(),
  /** `true` = quien puede ser miembro de un equipo de auditoría (rol global AUDITOR o GERENTE, docs/06 §1). */
  eligible: z.stringbool().optional(),
})
export type ListUsersQueryT = z.infer<typeof ListUsersQuery>
