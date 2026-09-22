import { defineMessages } from '../../platform/events/index.js'
import type { AuditRole } from '../../shared/enums.js'
import { type AuditField, AuditEvents } from './domain/events.js'

const FIELD_LABELS: Record<AuditField, string> = {
  name: 'el nombre',
  introduction: 'la introducción',
  scopeNotes: 'las notas de alcance',
  objectives: 'los objetivos',
  plannedStart: 'la fecha de inicio prevista',
  plannedEnd: 'la fecha de fin prevista',
}

const ROLE_LABELS: Record<AuditRole, string> = { LEAD: 'líder', MEMBER: 'auditor' }

/** Texto de cada evento de la auditoría. Sin él no compila (el mapa es exhaustivo). */
export const auditMessages = defineMessages(AuditEvents, {
  AuditCreated: (p) =>
    p.previousAuditCode
      ? `Creó la auditoría ${p.code} — ${p.name}, seguimiento de ${p.previousAuditCode} (${p.carriedOver ?? 0} criterios trasladados)`
      : `Creó la auditoría ${p.code} — ${p.name}`,
  AuditUpdated: (p) => `Modificó ${p.changed.map((field) => FIELD_LABELS[field]).join(', ')}`,
  ScopeItemAdded: (p) => `Agregó "${p.name}" al alcance`,
  ScopeItemRemoved: (p) => `Quitó "${p.name}" del alcance`,
  MemberAssigned: (p) => `Agregó a ${p.userName} al equipo como ${ROLE_LABELS[p.role]}`,
  MemberRoleChanged: (p) => `Cambió a ${p.userName} de ${ROLE_LABELS[p.from]} a ${ROLE_LABELS[p.to]}`,
  MemberRemoved: (p) => `Quitó a ${p.userName} del equipo (${ROLE_LABELS[p.role]})`,
  AuditTransferred: (p) => `Transfirió la auditoría de ${p.fromName} a ${p.toName}`,
  EvaluationAssigned: (p) =>
    p.previousUserName
      ? `Reasignó «${p.controlTitle}» de ${p.previousUserName} a ${p.userName}`
      : `Asignó «${p.controlTitle}» a ${p.userName}`,
  EvaluationUnassigned: (p) => `Quitó la asignación de «${p.controlTitle}» (era de ${p.previousUserName})`,
  EvaluationExpectedLevelSet: (p) =>
    p.previousLevelLabel
      ? `Cambió el nivel esperado de «${p.controlTitle}» de ${p.previousLevelLabel} a ${p.levelLabel}`
      : `Fijó el nivel esperado de «${p.controlTitle}» en ${p.levelLabel}`,
  AuditStarted: () => 'Inició la auditoría',
  AuditClosed: () => 'Cerró la auditoría',
  AuditArchived: () => 'Archivó la auditoría',
  EvaluationStarted: (p) => `Comenzó a trabajar en «${p.controlTitle}»`,
  EvaluationCompleted: (p) => `Envió «${p.controlTitle}» a revisión`,
  EvaluationApproved: (p) => (p.comments ? `Aprobó «${p.controlTitle}»: ${p.comments}` : `Aprobó «${p.controlTitle}»`),
  EvaluationReturned: (p) => `Devolvió «${p.controlTitle}»: ${p.comments}`,
  ReportGenerated: (p) => `Generó el informe "${p.title}"`,
  EvaluationReopened: (p) => `Reabrió «${p.controlTitle}» (estaba aprobado): ${p.comments}`,
})
