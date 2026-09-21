import { defineMessages } from '../../platform/events/index.js'
import { type AuditField, AuditEvents } from './domain/events.js'

const FIELD_LABELS: Record<AuditField, string> = {
  name: 'el nombre',
  introduction: 'la introducción',
  scopeNotes: 'las notas de alcance',
  objectives: 'los objetivos',
  plannedStart: 'la fecha de inicio prevista',
  plannedEnd: 'la fecha de fin prevista',
}

/** Texto de cada evento de la auditoría. Sin él no compila (el mapa es exhaustivo). */
export const auditMessages = defineMessages(AuditEvents, {
  AuditCreated: (p) => `Creó la auditoría ${p.code} — ${p.name}`,
  AuditUpdated: (p) => `Modificó ${p.changed.map((field) => FIELD_LABELS[field]).join(', ')}`,
  ScopeItemAdded: (p) => `Agregó "${p.name}" al alcance`,
  ScopeItemRemoved: (p) => `Quitó "${p.name}" del alcance`,
})
