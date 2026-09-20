import { HttpException } from '@nestjs/common'
import { DomainError, PlatformErrors, type ErrorDef } from '../errors/index.js'

/** Un error ya traducido a lo que se le responde al cliente. */
export interface Problem {
  readonly def: ErrorDef
  readonly status: number
  readonly details?: unknown
}

/** Errores de `http-errors` / body-parser (JSON mal formado, cuerpo demasiado grande…): traen `status` y `expose`. */
function isExposedHttpError(error: unknown): error is { status: number } {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { status?: unknown; expose?: unknown }
  return typeof candidate.status === 'number' && candidate.status >= 400 && candidate.status < 500 && candidate.expose === true
}

function byStatus(status: number): ErrorDef {
  switch (status) {
    case 401:
      return PlatformErrors.TOKEN_INVALID
    case 403:
      return PlatformErrors.FORBIDDEN
    case 404:
      return PlatformErrors.NOT_FOUND
    case 409:
      return PlatformErrors.CONFLICT
    case 429:
      return PlatformErrors.RATE_LIMITED
    default:
      return status >= 500 ? PlatformErrors.INTERNAL : PlatformErrors.VALIDATION_FAILED
  }
}

/**
 * Traduce cualquier excepción a un `Problem`. Punto único de traducción: aquí se enchufará también el traductor de
 * errores de Prisma (siguiente paso). Nunca filtra el mensaje ni el stack de errores desconocidos.
 */
export function toProblem(exception: unknown): Problem {
  if (exception instanceof DomainError) {
    return { def: exception.def, status: exception.def.http, details: exception.details }
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus()
    const body = exception.getResponse()
    return { def: byStatus(status), status, details: status === 400 && typeof body === 'object' ? body : undefined }
  }
  if (isExposedHttpError(exception)) {
    return { def: PlatformErrors.VALIDATION_FAILED, status: exception.status }
  }
  return { def: PlatformErrors.INTERNAL, status: 500 }
}
