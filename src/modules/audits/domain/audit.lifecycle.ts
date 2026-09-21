import { defineLifecycle } from '../../../platform/state/index.js'
import { AuditStatus } from '../../../shared/enums.js'
import { AuditErrors } from './errors.js'

/**
 * Ciclo de vida de la auditoría (docs/03 §2.4). Única definición de sus estados, transiciones y capacidades:
 *  - `editable`: solo en borrador se cambian datos y alcance, o se elimina.
 *  - `staffable`: el equipo se arma y se cambia en borrador y en curso.
 *  - `evaluable`: solo en curso se evalúa y se adjunta evidencia.
 *  - `followable`: solo una auditoría cerrada admite un seguimiento.
 */
export const AUDIT_EVENTS = ['START', 'CLOSE', 'ARCHIVE'] as const
export type AuditEvent = (typeof AUDIT_EVENTS)[number]
export type AuditTag = 'editable' | 'staffable' | 'evaluable' | 'followable'

export const auditLifecycle = defineLifecycle<AuditStatus, AuditEvent, AuditTag>({
  entity: 'AUDIT',
  invalidState: AuditErrors.AUDIT_INVALID_STATE,
  states: {
    DRAFT: { on: { START: 'IN_PROGRESS' }, tags: ['editable', 'staffable'] },
    IN_PROGRESS: { on: { CLOSE: 'CLOSED' }, tags: ['staffable', 'evaluable'] },
    CLOSED: { on: { ARCHIVE: 'ARCHIVED' }, tags: ['followable'] },
    ARCHIVED: { on: {}, tags: [] },
  },
})

/** Lanza AUDIT_NOT_EDITABLE si la auditoría no está en borrador. */
export function assertAuditEditable(status: AuditStatus): void {
  auditLifecycle.assert(status, 'editable', AuditErrors.AUDIT_NOT_EDITABLE)
}
