import { z } from 'zod'
import { Role } from '../../shared/enums.js'

export const ProfileView = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    username: z.string(),
    name: z.string(),
    roles: z.array(z.enum(Role)),
  }),
  /**
   * Reglas CASL empaquetadas (`packRules`). El frontend las reconstruye con `unpackRules` + `createMongoAbility`; no
   * reimplementa permisos. Debe usar la misma versión mayor de `@casl/ability` que el backend.
   */
  abilities: z.array(z.array(z.unknown())),
})
export type ProfileViewT = z.infer<typeof ProfileView>
