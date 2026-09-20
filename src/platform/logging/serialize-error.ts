import { DomainError } from '../errors/index.js'

const MAX_MESSAGE = 2_000
const MAX_CAUSE_DEPTH = 5

export interface SerializedError {
  type: string
  message: string
  stack?: string
  code?: string
  details?: unknown
  cause?: SerializedError
}

/**
 * Serializa un error para el log con una LISTA BLANCA de propiedades (tipo, mensaje, stack, y `code`/`details` si es un
 * `DomainError`), más la cadena de `cause`. Nunca se vuelcan las demás propiedades: un error de Prisma trae en `meta`
 * la fila que falló ("Failing row contains (...)"), y eso es un dato personal que no debe quedar en los logs.
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error).slice(0, MAX_MESSAGE) }

  const serialized: SerializedError = {
    type: error.name,
    message: error.message.slice(0, MAX_MESSAGE),
    ...(error.stack !== undefined && { stack: error.stack }),
  }
  if (error instanceof DomainError) {
    serialized.code = error.code
    if (error.details !== undefined) serialized.details = error.details
  }
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) serialized.cause = serializeError(error.cause, depth + 1)
  return serialized
}
