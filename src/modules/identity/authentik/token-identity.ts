import type { TokenClaims } from '../../../platform/auth/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import type { Role } from '../../../shared/enums.js'
import { IdentityErrors } from '../errors.js'
import { rolesFromGroups } from './roles-from-groups.js'

/** Lo que el sistema toma de un token de Authentik. */
export interface TokenIdentity {
  readonly authentikId: string
  readonly email: string
  readonly username: string
  readonly name: string
  readonly roles: Role[]
  readonly groups: string[]
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/**
 * Extrae la identidad de los claims verificados.
 *  - `email` se normaliza a minúsculas (la BD lo exige).
 *  - `preferred_username` se guarda TAL CUAL: es el usuario de Nextcloud al compartir carpetas. Si falta no se inventa
 *    uno (el proyecto anterior usaba `email.split('@')[0]`, que Nextcloud no conoce y hacía fallar los shares en
 *    silencio): se rechaza el acceso y se pide arreglar la configuración de Authentik.
 *  - `name` cae al username si no viene.
 */
export function identityFromClaims(claims: TokenClaims): TokenIdentity {
  const email = text(claims['email'])
  const username = text(claims['preferred_username'])

  const missing = [!email && 'email', !username && 'preferred_username'].filter(
    (claim): claim is string => typeof claim === 'string',
  )
  if (!email || !username || missing.length > 0) {
    throw new DomainError(IdentityErrors.TOKEN_CLAIMS_MISSING, { missing })
  }

  const groups = Array.isArray(claims['groups'])
    ? claims['groups'].filter((g): g is string => typeof g === 'string')
    : []
  return {
    authentikId: claims.sub,
    email: email.trim().toLowerCase(),
    username,
    name: text(claims['name'])?.trim() ?? username,
    roles: rolesFromGroups(groups),
    groups,
  }
}
