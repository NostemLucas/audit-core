import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { Action, Subject } from './abilities.js'

/**
 * Qué declara una ruta sobre su acceso. Es la ÚNICA fuente de ese vocabulario: la leen `AuthGuard`, `AbilitiesGuard`
 * y el verificador de rutas (que impide arrancar con una ruta sin declarar).
 *
 * Toda ruta declara EXACTAMENTE una:
 *   @Public()                      sin autenticación (login callbacks, health)
 *   @Can('read', 'Audit')          autenticada y con esa capacidad (CASL)
 *   @NoAbilityRequired()           autenticada, sin comprobar capacidad (p. ej. `GET /profile`)
 */
export type RouteAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'can'; readonly action: Action; readonly subject: Subject }
  | { readonly kind: 'no-ability-required' }

export const ROUTE_ACCESS = Symbol('ROUTE_ACCESS')

type Target = object
type Decorator = (target: Target, key?: string | symbol, descriptor?: PropertyDescriptor) => void

function declare(access: RouteAccess): Decorator {
  return (target, key, descriptor) => {
    const holder: Target = descriptor?.value ?? target
    if (Reflect.hasOwnMetadata(ROUTE_ACCESS, holder)) {
      const name = key ? String(key) : (target as { name?: string }).name
      throw new Error(
        `"${name}" declara acceso más de una vez: solo puede tener uno de @Public, @Can o @NoAbilityRequired`,
      )
    }
    Reflect.defineMetadata(ROUTE_ACCESS, access, holder)
  }
}

export const Public = (): Decorator => declare({ kind: 'public' })
export const NoAbilityRequired = (): Decorator => declare({ kind: 'no-ability-required' })
export const Can = (action: Action, subject: Subject): Decorator => declare({ kind: 'can', action, subject })

/** Lo declarado en la ruta (el método gana sobre la clase), o `undefined` si no declara nada. */
export function readRouteAccess(reflector: Reflector, context: ExecutionContext): RouteAccess | undefined {
  return reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [context.getHandler(), context.getClass()])
}
