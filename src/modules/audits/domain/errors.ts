import { defineErrors } from '../../../platform/errors/index.js'

export const AuditErrors = defineErrors({
  // ── Auditoría ──────────────────────────────────────────────────────────────
  AUDIT_NOT_FOUND: { http: 404, message: 'Auditoría no encontrada' },
  /** Transición que el ciclo de vida de la auditoría no permite desde el estado actual (docs/03). */
  AUDIT_INVALID_STATE: { http: 409, message: 'La auditoría no admite esa operación en su estado actual' },
  /** Capacidad `editable` (docs/03): solo una auditoría en borrador se edita o se elimina. */
  AUDIT_NOT_EDITABLE: { http: 409, message: 'Solo una auditoría en borrador puede modificarse o eliminarse' },
  /** Iniciar exige nivel esperado en cada control evaluable. `details.missing` = cuántos faltan. */
  AUDIT_EXPECTED_LEVELS_MISSING: { http: 422, message: 'Faltan niveles esperados en algunos controles' },
  /** La fecha de fin prevista es anterior a la de inicio. */
  AUDIT_DATES_INVALID: { http: 422, message: 'La fecha de fin prevista no puede ser anterior a la de inicio' },
  AUDIT_HAS_NO_MEMBERS: { http: 422, message: 'La auditoría necesita al menos un miembro para iniciarse' },
  AUDIT_HAS_PENDING_EVALUATIONS: {
    http: 422,
    message: 'Hay evaluaciones sin aprobar; no se puede cerrar la auditoría',
  },
  AUDIT_CANNOT_FOLLOW_UP: { http: 409, message: 'Solo una auditoría cerrada admite seguimiento' },
  /** Dos seguimientos de la misma auditoría se crearon a la vez y chocaron en el correlativo. */
  AUDIT_FOLLOW_UP_CONFLICT: {
    http: 409,
    message: 'Se creó otro seguimiento al mismo tiempo; vuelve a intentarlo',
    onUnique: 'audits_parentAuditId_followUpNumber_key',
  },
  /** Permiso contextual: el actor no es miembro (con el rol necesario) de esta auditoría. */
  AUDIT_ACCESS_DENIED: { http: 403, message: 'No participas en esta auditoría con el rol necesario' },

  // ── Alcance ────────────────────────────────────────────────────────────────
  /** Solo se edita el alcance con la auditoría en borrador (capacidad `editable`). */
  AUDIT_SCOPE_ITEM_NOT_FOUND: { http: 404, message: 'Elemento de alcance no encontrado' },
  AUDIT_SCOPE_ITEM_NAME_TAKEN: {
    http: 409,
    message: 'La auditoría ya tiene un elemento de alcance con ese nombre',
    onUnique: 'audit_scope_items_auditId_name_key',
  },
  /** Un seguimiento hereda el alcance de la auditoría que sigue; incluir algo distinto es otra auditoría. */
  AUDIT_SCOPE_INHERITED: {
    http: 409,
    message:
      'Un seguimiento hereda el alcance de la auditoría original; para incluir otros elementos crea una auditoría nueva',
  },

  // ── Equipo ─────────────────────────────────────────────────────────────────
  /** La auditoría ya tiene líder (índice único parcial en la BD): dos designaciones simultáneas, o designar sin quitar al actual. */
  AUDIT_LEAD_ALREADY_ASSIGNED: {
    http: 409,
    message: 'La auditoría ya tiene un líder',
    onUnique: 'audit_members_one_lead',
  },
  MEMBER_NOT_FOUND: { http: 404, message: 'Miembro no encontrado en la auditoría' },
  MEMBER_ALREADY_ASSIGNED: {
    http: 409,
    message: 'El usuario ya es miembro de la auditoría',
    onUnique: 'audit_members_auditId_userId_key',
  },
  /** El usuario no tiene un rol de sistema que le permita participar en auditorías. */
  MEMBER_USER_INELIGIBLE: { http: 422, message: 'El usuario no tiene un rol que le permita participar en auditorías' },

  // ── Evaluación ─────────────────────────────────────────────────────────────
  EVALUATION_NOT_FOUND: { http: 404, message: 'Evaluación no encontrada' },
  /** Transición que el ciclo de vida de la evaluación no permite desde el estado actual (docs/03). */
  EVALUATION_INVALID_STATE: { http: 409, message: 'La evaluación no admite esa operación en su estado actual' },
  /** Capacidad `editable`: solo en IN_PROGRESS o RETURNED se modifican nivel, hallazgos y notas. */
  EVALUATION_NOT_EDITABLE: { http: 409, message: 'La evaluación no puede modificarse en su estado actual' },
  EVALUATION_NOT_ASSIGNED: { http: 403, message: 'La evaluación no está asignada a este usuario' },
  /** Completar exige el nivel alcanzado (o marcarla no aplicable). */
  EVALUATION_INCOMPLETE: { http: 422, message: 'Faltan datos para completar la evaluación' },
  EVALUATION_LEVEL_NOT_IN_SCALE: { http: 422, message: 'El nivel no pertenece a la escala de la auditoría' },
  NOT_APPLICABLE_REASON_REQUIRED: { http: 422, message: 'Marcar como no aplicable requiere un motivo' },

  // ── Evidencia ──────────────────────────────────────────────────────────────
  EVIDENCE_NOT_FOUND: { http: 404, message: 'Evidencia no encontrada' },
  /** El mismo archivo de Nextcloud ya está registrado (p. ej. un webhook entregado dos veces): se trata como idempotente. */
  EVIDENCE_ALREADY_REGISTERED: {
    http: 409,
    message: 'Ese archivo ya está registrado como evidencia',
    onUnique: 'evidences_storageFileId_key',
  },
  /** No se adjunta ni se elimina evidencia de una evaluación cerrada (aprobada) o de una ronda anterior. */
  EVIDENCE_LOCKED: { http: 409, message: 'La evidencia de esta evaluación no admite cambios en su estado actual' },

  // ── Informes ───────────────────────────────────────────────────────────────
  REPORT_NOT_FOUND: { http: 404, message: 'Informe no encontrado' },
  REPORT_GENERATION_FAILED: { http: 502, message: 'No se pudo generar el informe' },
})
