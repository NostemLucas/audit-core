import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { DomainError, PlatformErrors } from '../errors/index.js'
import { defineAbilityFor } from './abilities.js'
import { readRouteAccess } from './route-access.js'

/**
 * Comprueba la capacidad que la ruta declara con `@Can`. Falla CERRADO: una ruta sin declarar se rechaza (aunque el
 * arranque ya impide que exista; ver `RouteProtectionCheck`). Se ejecuta después de `AuthGuard`, que fija `request.user`.
 */
@Injectable()
export class AbilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const access = readRouteAccess(this.reflector, context)
    if (access?.kind === 'public' || access?.kind === 'no-ability-required') return true
    if (access === undefined) throw new DomainError(PlatformErrors.FORBIDDEN, { reason: 'ruta sin acceso declarado' })

    const user = context.switchToHttp().getRequest<Request>().user
    if (!user || !defineAbilityFor(user.roles).can(access.action, access.subject)) {
      throw new DomainError(PlatformErrors.FORBIDDEN, { action: access.action, subject: access.subject })
    }
    return true
  }
}
