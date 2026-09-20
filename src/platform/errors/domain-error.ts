import type { ErrorDef } from './define-errors.js'

/**
 * Único tipo de error de negocio. Se lanza con una definición del catálogo:
 *   throw new DomainError(AuditErrors.AUDIT_NOT_EDITABLE, { auditId, status })
 * No hay una clase por error ni `HttpException` en el dominio: el filtro HTTP traduce `def.http`.
 */
export class DomainError extends Error {
  constructor(
    readonly def: ErrorDef,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: { cause?: unknown },
  ) {
    super(def.message, options)
    this.name = 'DomainError'
  }

  get code(): string {
    return this.def.code
  }

  get http(): number {
    return this.def.http
  }
}
