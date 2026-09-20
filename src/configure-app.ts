import { RequestMethod, VersioningType } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsMiddleware } from 'nestjs-cls'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response } from 'express'
import helmet from 'helmet'
import type { Env } from './platform/config/index.js'
import {
  AllExceptionsFilter,
  ApiSerializerInterceptor,
  EnvelopeInterceptor,
  accessLog,
  createValidationPipe,
  requestId,
} from './platform/http/index.js'
import { AppLogger } from './platform/logging/index.js'

/**
 * Configuración HTTP compartida por `main.ts` y por los tests e2e: lo que se prueba es lo que se ejecuta.
 * Rutas de negocio: `/api/v1/...`. Health (`/health/live`, `/health/ready`) queda fuera del prefijo y de la versión.
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  const logger = app.get(AppLogger)

  app.use(requestId)
  // Puente HTTP → contexto ambiental: abre el contexto de la petición y copia el `x-request-id` como `correlationId`.
  // Es lo único que conecta a HTTP con el contexto; el resto del sistema solo lee `correlationId` y `userId`.
  app.use(
    new ClsMiddleware({
      generateId: false,
      setup: (cls, _req, res: Response) => {
        const id = res.locals['requestId']
        if (typeof id === 'string' && id) cls.set('correlationId', id)
      },
    }).use,
  )
  app.use(accessLog(logger.for('Http')))
  app.use(helmet())
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true })
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  })
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalFilters(new AllExceptionsFilter(logger.for('ExceptionFilter')))
  app.useGlobalPipes(createValidationPipe())
  // El primero envuelve al segundo: la respuesta se serializa (esquema) y luego se envuelve ({ data, meta }).
  app.useGlobalInterceptors(new EnvelopeInterceptor(), new ApiSerializerInterceptor(app.get(Reflector)))
  app.enableShutdownHooks()
}
