import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { ROUTE_ACCESS, type RouteAccess } from './route-access.js'

export interface RouteInfo {
  readonly method: string
  readonly path: string
  readonly handler: string
  /** `undefined` = la ruta no declara acceso. */
  readonly access: RouteAccess | undefined
}

const joinPath = (...parts: unknown[]): string =>
  '/' + parts.flatMap((p) => (Array.isArray(p) ? p : [p])).map((p) => String(p ?? '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')

/** Recorre todas las rutas registradas y devuelve lo que cada una declara. Lo usan el arranque y los tests. */
export function listRoutes(discovery: DiscoveryService, scanner: MetadataScanner, reflector: Reflector): RouteInfo[] {
  const routes: RouteInfo[] = []
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper
    if (!instance || !metatype) continue
    const prototype = Object.getPrototypeOf(instance) as object
    const basePath = reflector.get<string | string[] | undefined>(PATH_METADATA, metatype)

    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[name] as (...args: unknown[]) => unknown
      const method = reflector.get<number | undefined>(METHOD_METADATA, handler)
      if (method === undefined) continue // no es un endpoint
      routes.push({
        method: RequestMethod[method] ?? String(method),
        path: joinPath(basePath, reflector.get(PATH_METADATA, handler)),
        handler: `${metatype.name}.${name}`,
        access: reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [handler, metatype]),
      })
    }
  }
  return routes
}
