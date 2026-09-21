/**
 * Raíz de composición del catálogo de eventos (igual que `app-errors.ts` para los errores). Cada módulo que declare
 * eventos y mensajes los exporta aquí, para que el historial y el test del catálogo vean el conjunto completo.
 */
export { AuditEvents } from './modules/audits/domain/events.js'
export { auditMessages } from './modules/audits/messages.es.js'
