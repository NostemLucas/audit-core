import type { JWTPayload } from 'jose'
import type { AuthenticatedUser } from './authenticated-user.js'

/** Claims de un token YA verificado (firma, `iss`, `aud`, expiración). `sub` está garantizado. */
export type TokenClaims = JWTPayload & { sub: string }

/**
 * PUERTO: lo que la plataforma necesita de la identidad. `platform/auth` verifica el token y pide a quien implemente
 * este puerto (el módulo `identity`) que lo convierta en un usuario local. Así la plataforma no importa módulos de negocio.
 */
export interface UserResolver {
  resolve(claims: TokenClaims): Promise<AuthenticatedUser>
}

export const USER_RESOLVER = Symbol('USER_RESOLVER')
