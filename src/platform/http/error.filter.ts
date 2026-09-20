import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Log } from '../logging/index.js'
import { toProblem } from './problem.js'

/**
 * Único formato de error del API:
 *   { "error": { "code", "message", "details"?, "traceId" } }
 * `code` y `message` salen del catálogo; nada del error original se filtra al cliente.
 *
 * Qué se registra: un fallo NUESTRO (>= 500) con su error completo (`err`, incluida la cadena de causas). Un error de
 * negocio (4xx) es un resultado esperado: solo `debug`; el log de acceso ya deja constancia de la petición y su estado.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly log: Log) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const request = http.getRequest<Request>()
    const traceId = String(response.locals['requestId'] ?? 'unknown')

    const { def, status, details } = toProblem(exception)
    const where = { method: request.method, path: request.originalUrl.split('?')[0], code: def.code, status }

    if (status >= 500) this.log.error('Error no controlado', { ...where, err: exception })
    else this.log.debug('Error de negocio', where)

    response.status(status).json({
      error: { code: def.code, message: def.message, ...(details !== undefined && { details }), traceId },
    })
  }
}
