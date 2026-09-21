import { DomainError } from '../../../platform/errors/index.js'
import { LibraryErrors } from '../errors.js'
import type { ImportIssue } from './domain/control-import.js'

/** Cuántos errores se devuelven al cliente en una importación fallida (el total se informa aparte). */
const MAX_ISSUES_REPORTED = 20

/** El archivo tiene errores: todos juntos con su fila, para corregirlo de una vez. */
export function importError(issues: readonly ImportIssue[]): DomainError {
  return new DomainError(LibraryErrors.TEMPLATE_IMPORT_INVALID, {
    errors: issues.slice(0, MAX_ISSUES_REPORTED),
    totalErrors: issues.length,
  })
}
