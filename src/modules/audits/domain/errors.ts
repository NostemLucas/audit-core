import { defineErrors } from '../../../platform/errors/index.js'

export const AuditErrors = defineErrors({
  // ── Auditoría ──────────────────────────────────────────────────────────────
  AUDIT_NOT_FOUND: { http: 404, message: 'Auditoría no encontrada' },
  /** Transición que el ciclo de vida de la auditoría no permite desde el estado actual (docs/03). */
  AUDIT_INVALID_STATE: { http: 409, message: 'La auditoría no admite esa operación en su estado actual' },
  /** Capacidad `editable` (docs/03): solo una auditoría en borrador se edita o se elimina. */
  AUDIT_NOT_EDITABLE: { http: 409, message: 'Solo una auditoría en borrador puede modificarse o eliminarse' },
  /** Iniciar exige nivel esperado en cada control evaluable. `details.missing` = cuántos faltan. Solo puede darse en una
   * auditoría MATURITY: en CONFORMITY el nivel esperado se fija solo, al crear (docs/06 §2). */
  AUDIT_EXPECTED_LEVELS_MISSING: { http: 422, message: 'Faltan niveles esperados en algunos criterios' },
  /** Iniciar exige que todo criterio tenga responsable. `details.missing` = cuántos faltan. */
  AUDIT_UNASSIGNED_EVALUATIONS: { http: 422, message: 'Hay criterios sin asignar a un auditor' },
  /** Iniciar exige un líder designado. */
  AUDIT_HAS_NO_LEAD: { http: 422, message: 'La auditoría necesita un líder para iniciarse' },
  /** La fecha de fin prevista es anterior a la de inicio. */
  AUDIT_DATES_INVALID: { http: 422, message: 'La fecha de fin prevista no puede ser anterior a la de inicio' },
  /** Iniciar exige al menos un auditor (además del líder). */
  AUDIT_HAS_NO_MEMBERS: { http: 422, message: 'La auditoría necesita al menos un auditor para iniciarse' },
  AUDIT_HAS_PENDING_EVALUATIONS: {
    http: 422,
    message: 'Hay evaluaciones sin aprobar; no se puede cerrar la auditoría',
  },
  AUDIT_CANNOT_FOLLOW_UP: {
    http: 409,
    message: 'Solo una auditoría cerrada o archivada puede tomarse de referencia para un seguimiento',
  },
  /** Permiso contextual: el actor no es miembro (con el rol necesario) de esta auditoría. */
  AUDIT_ACCESS_DENIED: { http: 403, message: 'No participas en esta auditoría con el rol necesario' },
  /** Capacidad `evaluable` (docs/03): las acciones sobre un criterio exigen la auditoría en curso. */
  AUDIT_NOT_EVALUABLE: { http: 409, message: 'La auditoría debe estar en curso para actuar sobre sus criterios' },

  // ── Alcance ────────────────────────────────────────────────────────────────
  /** Solo se edita el alcance con la auditoría en borrador (capacidad `editable`). */
  AUDIT_SCOPE_ITEM_NOT_FOUND: { http: 404, message: 'Elemento de alcance no encontrado' },
  AUDIT_SCOPE_ITEM_NAME_TAKEN: {
    http: 409,
    message: 'La auditoría ya tiene un elemento de alcance con ese nombre',
    onUnique: 'audit_scope_items_auditId_name_key',
  },
  /** Con criterios trasladados el resultado vale para ESE alcance: cambiarlo invalidaría lo trasladado (docs/06 §9). */
  AUDIT_SCOPE_INHERITED: {
    http: 409,
    message:
      'Esta auditoría traslada criterios de la anterior y hereda su alcance; para auditar otro alcance crea la auditoría sin trasladar criterios',
  },

  // ── Equipo ─────────────────────────────────────────────────────────────────
  /** El equipo (miembros y asignación de criterios) solo cambia con la auditoría en borrador o en curso (capacidad `staffable`). */
  AUDIT_TEAM_LOCKED: { http: 409, message: 'El equipo solo puede cambiar con la auditoría en borrador o en curso' },
  /** El nuevo manager de una transferencia debe poder dirigir auditorías (rol global GERENTE). */
  AUDIT_MANAGER_INELIGIBLE: { http: 422, message: 'El nuevo manager debe tener el rol GERENTE' },
  /** La auditoría ya tiene líder (índice único parcial en la BD): dos designaciones simultáneas, o designar sin quitar al actual. */
  AUDIT_LEAD_ALREADY_ASSIGNED: {
    http: 409,
    message: 'La auditoría ya tiene un líder',
    onUnique: 'audit_members_one_lead',
  },
  /** No se quita ni se hace líder a un miembro con criterios asignados: se reasignan antes. `details.count` = cuántos. */
  MEMBER_HAS_ASSIGNED_EVALUATIONS: { http: 409, message: 'El miembro tiene criterios asignados; reasígnalos antes' },
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
  /** Solo se asignan criterios a los AUDITORES (`MEMBER`) del equipo: `details.reason` = NOT_IN_TEAM o IS_LEAD (el líder revisa, no evalúa). */
  EVALUATION_ASSIGNEE_INVALID: { http: 422, message: 'Solo se asignan criterios a los auditores del equipo' },
  /** Un criterio enviado a revisión o aprobado no cambia de responsable (capacidad `reassignable`). `details.evaluationIds` = los que lo impiden. */
  EVALUATION_NOT_REASSIGNABLE: {
    http: 409,
    message: 'No se puede cambiar la asignación de criterios enviados a revisión o aprobados',
  },
  /** Enviar a revisión exige nivel alcanzado (o N/A con motivo) y, según el caso, hallazgo y/o evidencia (docs/06 §3).
   * `details.missing`: ACHIEVED_LEVEL_OR_NOT_APPLICABLE | NOT_APPLICABLE_REASON | FINDINGS | EVIDENCE. */
  EVALUATION_INCOMPLETE: { http: 422, message: 'Faltan datos para enviar el criterio a revisión' },
  EVALUATION_LEVEL_NOT_IN_SCALE: { http: 422, message: 'El nivel no pertenece a la escala de la auditoría' },
  NOT_APPLICABLE_REASON_REQUIRED: { http: 422, message: 'Marcar como no aplicable requiere un motivo' },
  /** "No aplica" y nivel alcanzado son excluyentes: para fijar un nivel hay que desmarcar antes "no aplica" (`isNotApplicable: false`). */
  EVALUATION_IS_NOT_APPLICABLE: {
    http: 409,
    message: 'El criterio está marcado como no aplica; desmárcalo antes de fijar un nivel alcanzado',
  },
  /** Un criterio enviado a revisión o aprobado no cambia de nivel esperado (mismo motivo que EVALUATION_NOT_REASSIGNABLE: cambiar
   * el objetivo después de evaluar invalidaría lo ya enviado). `details.evaluationIds` = los que lo impiden. */
  EVALUATION_EXPECTED_LEVEL_LOCKED: {
    http: 409,
    message: 'No se puede cambiar el nivel esperado de criterios enviados a revisión o aprobados',
  },

  // ── Evidencia ──────────────────────────────────────────────────────────────
  EVIDENCE_NOT_FOUND: { http: 404, message: 'Evidencia no encontrada' },
  /** El mismo archivo de Nextcloud ya está registrado (p. ej. un webhook entregado dos veces): se trata como idempotente. */
  EVIDENCE_ALREADY_REGISTERED: {
    http: 409,
    message: 'Ese archivo ya está registrado como evidencia',
    onUnique: 'evidences_storageFileId_key',
  },
  /** Misma ventana que editar el contenido (`editable`: IN_PROGRESS o RETURNED, docs/06 §3): no se adjunta ni se
   * elimina evidencia de un criterio sin arrancar, enviado a revisión o aprobado. */
  EVIDENCE_LOCKED: { http: 409, message: 'La evidencia de esta evaluación no admite cambios en su estado actual' },
  /** La ruta del archivo (del webhook de Nextcloud) no tiene la forma `.../Evidencias/{evaluationId}/...` (docs/07 §1.2). */
  EVIDENCE_PATH_INVALID: { http: 422, message: 'La ruta del archivo no corresponde a ningún criterio' },

  // ── Informes ───────────────────────────────────────────────────────────────
  REPORT_NOT_FOUND: { http: 404, message: 'Informe no encontrado' },
  REPORT_GENERATION_FAILED: { http: 502, message: 'No se pudo generar el informe' },
  /** Capacidad `reportable` (docs/03): un informe es el consolidado final, no una foto a medio evaluar con huecos. */
  AUDIT_NOT_REPORTABLE: {
    http: 409,
    message: 'Solo una auditoría cerrada o archivada puede generar un informe',
  },

  // ── Plantillas de informe (docs/07 §2) ──────────────────────────────────────
  REPORT_TEMPLATE_NOT_FOUND: { http: 404, message: 'Plantilla de informe no encontrada' },
  /** El .docx no es válido, o al rellenarlo con datos de prueba queda algún marcador sin resolver o el texto "undefined". */
  REPORT_TEMPLATE_INVALID: { http: 422, message: 'La plantilla no es un .docx válido para generar informes' },
})
