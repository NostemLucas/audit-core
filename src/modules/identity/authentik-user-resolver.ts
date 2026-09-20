import { Injectable } from '@nestjs/common'
import type { AuthenticatedUser, TokenClaims, UserResolver } from '../../platform/auth/index.js'
import { InjectTx, Transactional, type Tx } from '../../platform/db/index.js'
import { AppLogger, type Log } from '../../platform/logging/index.js'
import { Role } from '../../shared/enums.js'
import { retryOnceOnIdentityConflict } from './retry-identity-conflict.js'
import { identityFromClaims, type TokenIdentity } from './token-identity.js'

const sameRoles = (a: readonly Role[], b: readonly Role[]): boolean => a.length === b.length && a.every((role, i) => role === b[i])

const ROLE_ORDER: readonly Role[] = [Role.ADMIN, Role.GERENTE, Role.AUDITOR]
const sortRoles = (roles: readonly Role[]): Role[] => ROLE_ORDER.filter((role) => roles.includes(role))

interface UserRow {
  id: string
  email: string
  username: string
  name: string
  roles: Role[]
}
const toAuthenticated = (row: UserRow): AuthenticatedUser => ({ id: row.id, email: row.email, username: row.username, name: row.name, roles: sortRoles(row.roles) })

/**
 * Implementa el puerto `UserResolver`: convierte un token verificado en el usuario local, sincronizándolo con Authentik.
 *
 *  - Se busca SOLO por `authentikId` (`sub`, inmutable). No hay vínculo por email: sin cuentas heredadas que migrar,
 *    enlazar por email permitiría que quien reciba un email reasignado herede la cuenta de otra persona.
 *  - Se ESCRIBE solo si algo cambió: en una petición normal es una lectura por índice.
 *  - Authentik decide todo: el sistema no activa, desactiva ni edita usuarios.
 *  - Un choque de unicidad (dos logins simultáneos del mismo usuario nuevo) se reintenta UNA vez (ver
 *    `retryOnceOnIdentityConflict`); si persiste es un conflicto real y sale como USER_IDENTITY_CONFLICT (409).
 */
@Injectable()
export class AuthentikUserResolver implements UserResolver {
  private readonly log: Log

  constructor(
    @InjectTx() private readonly tx: Tx,
    logger: AppLogger,
  ) {
    this.log = logger.for('AuthentikUserResolver')
  }

  async resolve(claims: TokenClaims): Promise<AuthenticatedUser> {
    const identity = identityFromClaims(claims)
    return retryOnceOnIdentityConflict(() => this.sync(identity))
  }

  @Transactional()
  private async sync(identity: TokenIdentity): Promise<AuthenticatedUser> {
    const existing = await this.tx.user.findUnique({ where: { authentikId: identity.authentikId } })

    if (!existing) {
      const created = await this.tx.user.create({
        data: { authentikId: identity.authentikId, email: identity.email, username: identity.username, name: identity.name, roles: identity.roles },
      })
      this.log.info('Usuario creado desde Authentik', { userId: created.id, roles: created.roles })
      if (created.roles.length === 0) this.warnNoRole(created.id, identity.groups)
      return toAuthenticated(created)
    }

    const roles = await this.protectLastAdmin(existing, identity.roles)
    const unchanged =
      existing.email === identity.email && existing.username === identity.username && existing.name === identity.name && sameRoles(sortRoles(existing.roles), roles)
    if (unchanged) return toAuthenticated(existing)

    const updated = await this.tx.user.update({
      where: { id: existing.id },
      data: { email: identity.email, username: identity.username, name: identity.name, roles },
    })
    this.log.info('Usuario actualizado desde Authentik', { userId: updated.id, roles: updated.roles })
    if (updated.roles.length === 0 && existing.roles.length > 0) this.warnNoRole(updated.id, identity.groups)
    return toAuthenticated(updated)
  }

  /**
   * El sistema nunca debe quedarse sin ningún ADMIN por un cambio en Authentik. Si la sincronización le quitaría el rol
   * al ÚNICO administrador, se conserva y se avisa: hay que asignar ADMIN a otra persona en Authentik antes de retirarlo.
   */
  private async protectLastAdmin(existing: UserRow, incoming: readonly Role[]): Promise<Role[]> {
    const losingAdmin = existing.roles.includes(Role.ADMIN) && !incoming.includes(Role.ADMIN)
    if (!losingAdmin) return sortRoles(incoming)

    const otherAdmins = await this.tx.user.count({ where: { id: { not: existing.id }, roles: { has: Role.ADMIN } } })
    if (otherAdmins > 0) return sortRoles(incoming)

    this.log.warn('Se conserva ADMIN: es el único administrador del sistema', { userId: existing.id })
    return sortRoles([...incoming, Role.ADMIN])
  }

  private warnNoRole(userId: string, groups: readonly string[]): void {
    this.log.warn('Usuario sin ningún rol reconocido; asígnale un grupo (admin, gerente/manager o auditor) en Authentik', { userId, groups })
  }
}
