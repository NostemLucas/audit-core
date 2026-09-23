import { defineLifecycle } from '../../../platform/state/index.js'
import { AuditStatus } from '../../../shared/enums.js'
import { AuditErrors } from './errors.js'

/**
 * Ciclo de vida de la auditoría (docs/03 §2.4). Única definición de sus estados, transiciones y capacidades:
 *  - `editable`: solo en borrador se cambian datos y alcance, o se elimina.
 *  - `staffable`: el equipo se arma y se cambia en borrador y en curso.
 *  - `evaluable`: solo en curso se evalúa y se adjunta evidencia.
 *  - `followable`: una auditoría cerrada (o ya archivada) puede tomarse de referencia para un seguimiento (docs/06 §9).
 *  - `reportable`: se puede generar un informe — el consolidado final, no una foto a medio evaluar con huecos y
 *    placeholders. Hoy coincide con `followable` (CLOSED y ARCHIVED), pero es una regla de negocio distinta: se
 *    declara aparte para que un cambio futuro en una no mueva la otra por accidente.
 */
export const AUDIT_EVENTS = ['START', 'CLOSE', 'ARCHIVE'] as const
export type AuditEvent = (typeof AUDIT_EVENTS)[number]
export type AuditTag = 'editable' | 'staffable' | 'evaluable' | 'followable' | 'reportable'

export const auditLifecycle = defineLifecycle<AuditStatus, AuditEvent, AuditTag>({
  entity: 'AUDIT',
  invalidState: AuditErrors.AUDIT_INVALID_STATE,
  states: {
    DRAFT: { on: { START: 'IN_PROGRESS' }, tags: ['editable', 'staffable'] },
    IN_PROGRESS: { on: { CLOSE: 'CLOSED' }, tags: ['staffable', 'evaluable'] },
    CLOSED: { on: { ARCHIVE: 'ARCHIVED' }, tags: ['followable', 'reportable'] },
    ARCHIVED: { on: {}, tags: ['followable', 'reportable'] },
  },
})

/** Lanza AUDIT_TEAM_LOCKED si el equipo ya no puede cambiar (auditoría cerrada o archivada). */
export function assertAuditStaffable(status: AuditStatus): void {
  auditLifecycle.assert(status, 'staffable', AuditErrors.AUDIT_TEAM_LOCKED)
}

/** Lanza AUDIT_NOT_EVALUABLE si la auditoría no está en curso: docs/03 regla 10, cada acción sobre un criterio exige
 * primero que SU auditoría esté en curso (evaluar, enviar, revisar; también quitarlo de revisión). */
export function assertAuditEvaluable(status: AuditStatus): void {
  auditLifecycle.assert(status, 'evaluable', AuditErrors.AUDIT_NOT_EVALUABLE)
}

/** Lanza AUDIT_NOT_EDITABLE si la auditoría no está en borrador. */
export function assertAuditEditable(status: AuditStatus): void {
  auditLifecycle.assert(status, 'editable', AuditErrors.AUDIT_NOT_EDITABLE)
}

/** Lanza AUDIT_NOT_REPORTABLE si la auditoría no está cerrada (ni archivada): un informe es el consolidado final. */
export function assertAuditReportable(status: AuditStatus): void {
  auditLifecycle.assert(status, 'reportable', AuditErrors.AUDIT_NOT_REPORTABLE)
}
