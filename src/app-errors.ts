/**
 * Raíz de composición del catálogo de errores. Importar este archivo registra TODOS los errores del sistema
 * (los módulos registran los suyos al cargarse). El arranque de la app y los tests lo importan para que el
 * traductor de errores de Prisma y el OpenAPI vean el catálogo completo.
 */
export { PlatformErrors } from './platform/errors/index.js'
export { IdentityErrors } from './modules/identity/errors.js'
export { OrganizationErrors } from './modules/organizations/errors.js'
export { LibraryErrors } from './modules/library/errors.js'
export { AuditErrors } from './modules/audits/domain/errors.js'
