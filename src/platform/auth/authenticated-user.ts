import type { Role } from '../../shared/enums.js'

/** El usuario autenticado de la petición: el espejo local de su cuenta en Authentik. */
export interface AuthenticatedUser {
  readonly id: string
  readonly email: string
  readonly username: string
  readonly name: string
  readonly roles: readonly Role[]
}

declare global {
  namespace Express {
    interface Request {
      /** Lo fija `AuthGuard`. Ausente en rutas `@Public()`. */
      user?: AuthenticatedUser
    }
  }
}
