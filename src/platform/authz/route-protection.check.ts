import { Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { listRoutes } from './route-walker.js'

/**
 * Red de seguridad: la aplicación NO ARRANCA si alguna ruta no declara su acceso. Es más fuerte que un test (que solo
 * corre en CI): un endpoint olvidado no puede llegar a producción. `AbilitiesGuard` además falla cerrado en ejecución.
 */
@Injectable()
export class RouteProtectionCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared = listRoutes(this.discovery, this.scanner, this.reflector).filter(
      (route) => route.access === undefined,
    )
    if (undeclared.length === 0) return
    const lines = undeclared.map((r) => `  - ${r.method} ${r.path}  (${r.handler})`)
    throw new Error(
      `Rutas sin acceso declarado. Cada ruta debe llevar @Public(), @Can(acción, sujeto) o @NoAbilityRequired():\n${lines.join('\n')}`,
    )
  }
}
