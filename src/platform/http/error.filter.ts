import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { toProblem } from './problem.js'

/**
 * Único formato de error del API:
 *   { "error": { "code", "message", "details"?, "traceId" } }
 * `code` y `message` salen del catálogo; nada del error original se filtra al cliente.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const request = http.getRequest<Request>()
    const traceId = String(response.locals['requestId'] ?? 'unknown')

    const { def, status, details } = toProblem(exception)

    if (status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception))
      this.logger.error(`${request.method} ${request.originalUrl} → ${def.code} [${traceId}]`, error.stack)
    }

    response.status(status).json({
      error: { code: def.code, message: def.message, ...(details !== undefined && { details }), traceId },
    })
  }
}
