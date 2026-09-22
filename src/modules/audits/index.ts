export { AuditsModule } from './audits.module.js'
/** Qué auditorías puede ver un actor (docs/06 §1): única fuente, la usa también `dashboard` (docs/08 §1). */
export { visibleAuditsWhere } from './infrastructure/audit.queries.js'
