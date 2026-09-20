import { RequestMethod, VersioningType } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import type { Env } from './platform/config/index.js'
import { AllExceptionsFilter, EnvelopeInterceptor, requestId } from './platform/http/index.js'

/**
 * Configuración HTTP compartida por `main.ts` y por los tests e2e: lo que se prueba es lo que se ejecuta.
 * Rutas de negocio: `/api/v1/...`. Health queda fuera del prefijo y de la versión.
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.use(requestId)
  app.use(helmet())
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true })
  app.setGlobalPrefix('api', { exclude: [{ path: 'health/live', method: RequestMethod.GET }] })
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new EnvelopeInterceptor())
  app.enableShutdownHooks()
}
