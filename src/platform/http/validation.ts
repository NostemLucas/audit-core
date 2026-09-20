import { StandardSchemaValidationPipe } from '@nestjs/common'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { DomainError, PlatformErrors } from '../errors/index.js'

function pathToString(path: StandardSchemaV1.Issue['path']): string {
  return (path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.')
}

/**
 * Pipe global de validación de entrada, nativo de Nest 12 (Standard Schema): valida y transforma lo que cada
 * endpoint declare con `@Body({ schema })`, `@Query({ schema })` o `@Param('id', { schema })`.
 * Los fallos salen como VALIDATION_FAILED con `details.issues: [{ path, message }]`.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) =>
      new DomainError(PlatformErrors.VALIDATION_FAILED, {
        issues: issues.map((issue) => ({ path: pathToString(issue.path), message: issue.message })),
      }),
  })
}
