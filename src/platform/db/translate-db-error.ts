import { Prisma } from '../../generated/prisma/client.js'
import { DomainError, PlatformErrors, errorRegistry } from '../errors/index.js'

/** Forma que Prisma 7 + adaptador `pg` da a `meta` (verificada contra Postgres real; ver test de integración). */
interface DriverCause {
  readonly originalCode?: string
  readonly code?: string
  readonly constraint?: { readonly index?: string }
}
interface DbErrorMeta {
  readonly modelName?: string
  readonly driverAdapterError?: { readonly cause?: DriverCause }
}

const DELETE_OPERATIONS: ReadonlySet<string> = new Set(['delete', 'deleteMany'])
const CHECK_VIOLATION = '23514'

/**
 * Traduce un error de Prisma al error del catálogo que corresponde. Punto único (ver docs/02 §3):
 *  - P2002 (único)       → el error que declaró `onUnique` con ese nombre de restricción; si no hay, CONFLICT.
 *  - P2003 (FK)          → al BORRAR: el error que declaró `onForeignKeyDelete`; al escribir: REFERENCE_INVALID.
 *                          Se decide por la operación, no por el texto del mensaje (depende del idioma del servidor).
 *  - P2025 (no existe)   → NOT_FOUND.
 *  - CHECK (SQLSTATE 23514) → INTEGRITY_VIOLATION (red de seguridad; el dominio valida antes).
 * Todo lo demás se devuelve tal cual (acaba en INTERNAL). `details` nunca lleva datos de la fila ni el nombre de
 * la restricción: eso queda en `cause`, que solo se registra en el servidor.
 */
export function translateDbError(error: unknown, operation: string): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error

  const meta = error.meta as DbErrorMeta | undefined
  const cause = meta?.driverAdapterError?.cause
  const constraint = cause?.constraint?.index
  const options = { cause: error }

  switch (error.code) {
    case 'P2002':
      return new DomainError(
        (constraint && errorRegistry.byUnique(constraint)) || PlatformErrors.CONFLICT,
        undefined,
        options,
      )
    case 'P2003':
      if (DELETE_OPERATIONS.has(operation)) {
        return new DomainError(
          (constraint && errorRegistry.byForeignKeyDelete(constraint)) || PlatformErrors.CONFLICT,
          undefined,
          options,
        )
      }
      return new DomainError(PlatformErrors.REFERENCE_INVALID, undefined, options)
    case 'P2025':
      return new DomainError(PlatformErrors.NOT_FOUND, { model: meta?.modelName }, options)
  }

  if ((cause?.originalCode ?? cause?.code) === CHECK_VIOLATION) {
    return new DomainError(PlatformErrors.INTEGRITY_VIOLATION, undefined, options)
  }
  return error
}
