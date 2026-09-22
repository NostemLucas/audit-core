import { z } from 'zod'
// Import directo del archivo puro: el `index` de platform/events arrastra el bus (Nest) y `domain/` no puede importar Nest.
import { defineEvents } from '../../../platform/events/define-events.js'
import { AuditRole, EvaluationSeverity } from '../../../shared/enums.js'

/**
 * Eventos de la auditoría: lo que se guarda en `audit_events`. Cada payload lleva `auditId`; además, y solo si aplica:
 *  - `targetUserId`: a quién afecta (el miembro que entra, el inspector al que se asigna un criterio);
 *  - `evaluationId` / `memberId` / `scopeItemId`: qué cambia (de ahí sale el `subjectType` del historial, ver `subjectOf`).
 * El texto de cada evento está en `messages.es.ts`. Agregar un evento = su esquema aquí + su mensaje allí.
 */
const audit = { auditId: z.uuid() }

/** Campos de la auditoría que se editan en borrador (los que puede nombrar `AuditUpdated`). */
export const AUDIT_FIELDS = ['name', 'introduction', 'scopeNotes', 'objectives', 'plannedStart', 'plannedEnd'] as const
export type AuditField = (typeof AUDIT_FIELDS)[number]

export const AuditEvents = defineEvents({
  AuditCreated: z.object({
    ...audit,
    code: z.string(),
    name: z.string(),
    /** Solo un seguimiento: el código de la anterior y cuántos criterios se trasladaron (docs/06 §9). */
    previousAuditCode: z.string().optional(),
    carriedOver: z.int().optional(),
  }),
  AuditUpdated: z.object({ ...audit, changed: z.array(z.enum(AUDIT_FIELDS)).min(1) }),
  ScopeItemAdded: z.object({ ...audit, scopeItemId: z.uuid(), name: z.string() }),
  ScopeItemRemoved: z.object({ ...audit, scopeItemId: z.uuid(), name: z.string() }),
  // Equipo. Los nombres van en el evento (desnormalizados) porque el texto se genera al leer, sin consultar nada más.
  MemberAssigned: z.object({
    ...audit,
    memberId: z.uuid(),
    targetUserId: z.uuid(),
    userName: z.string(),
    role: z.enum(AuditRole),
  }),
  MemberRoleChanged: z.object({
    ...audit,
    memberId: z.uuid(),
    targetUserId: z.uuid(),
    userName: z.string(),
    from: z.enum(AuditRole),
    to: z.enum(AuditRole),
  }),
  MemberRemoved: z.object({
    ...audit,
    memberId: z.uuid(),
    targetUserId: z.uuid(),
    userName: z.string(),
    role: z.enum(AuditRole),
  }),
  AuditTransferred: z.object({ ...audit, fromName: z.string(), targetUserId: z.uuid(), toName: z.string() }),
  // Asignación de criterios: el sujeto es el criterio (evaluationId), para poder pedir su historia.
  EvaluationAssigned: z.object({
    ...audit,
    evaluationId: z.uuid(),
    controlTitle: z.string(),
    targetUserId: z.uuid(),
    userName: z.string(),
    /** A quién estaba asignado antes, si alguien. */
    previousUserName: z.string().nullable(),
  }),
  EvaluationUnassigned: z.object({
    ...audit,
    evaluationId: z.uuid(),
    controlTitle: z.string(),
    /** A quién estaba asignado: es el usuario afectado. */
    targetUserId: z.uuid(),
    previousUserName: z.string(),
  }),
  /** Lo fija el líder (uno a uno o en bloque); NO se publica cuando el sistema lo fija solo al crear una auditoría CONFORMITY
   * (docs/06 §2): ahí no hay ninguna decisión que registrar. */
  EvaluationExpectedLevelSet: z.object({
    ...audit,
    evaluationId: z.uuid(),
    controlTitle: z.string(),
    levelLabel: z.string(),
    previousLevelLabel: z.string().nullable(),
  }),
  // Ciclo de vida de la auditoría.
  AuditStarted: z.object({ ...audit }),
  AuditClosed: z.object({ ...audit }),
  AuditArchived: z.object({ ...audit }),
  // Ciclo de vida de un criterio (docs/06 §3, §4). El sujeto es la evaluación.
  EvaluationStarted: z.object({ ...audit, evaluationId: z.uuid(), controlTitle: z.string() }),
  /** Lleva una COPIA del contenido enviado (docs/06 §4): permite ver "cómo estaba" sin tabla de revisiones aparte. */
  EvaluationCompleted: z.object({
    ...audit,
    evaluationId: z.uuid(),
    controlTitle: z.string(),
    achievedLevelLabel: z.string().nullable(),
    isNotApplicable: z.boolean(),
    notApplicableReason: z.string().nullable(),
    findings: z.string().nullable(),
    severity: z.enum(EvaluationSeverity).nullable(),
    notes: z.string().nullable(),
    evidence: z.array(z.object({ id: z.uuid(), title: z.string() })),
  }),
  EvaluationApproved: z.object({
    ...audit,
    evaluationId: z.uuid(),
    controlTitle: z.string(),
    comments: z.string().nullable(),
    /** El líder lo pide al aprobar (docs/06 §3, §9): este criterio no se traslada solo en el próximo seguimiento. */
    requiresFollowUp: z.boolean(),
  }),
  EvaluationReturned: z.object({ ...audit, evaluationId: z.uuid(), controlTitle: z.string(), comments: z.string() }),
  EvaluationReopened: z.object({ ...audit, evaluationId: z.uuid(), controlTitle: z.string(), comments: z.string() }),
  // Informes (docs/07 §2). El sujeto es la auditoría: un informe no tiene su propia historia aparte.
  ReportGenerated: z.object({ ...audit, reportId: z.uuid(), title: z.string() }),
})

export const AUDIT_EVENT_NAMES: ReadonlySet<string> = new Set(Object.keys(AuditEvents))

/** Lo que el registrador necesita de cualquier payload (todos lo cumplen: lo exige el test del catálogo). */
export interface AuditEventPayload {
  readonly auditId: string
  readonly targetUserId?: string
  readonly evaluationId?: string
  readonly memberId?: string
  readonly scopeItemId?: string
}

export type SubjectType = 'Audit' | 'Evaluation' | 'AuditMember' | 'ScopeItem'

/**
 * Sobre qué trata el evento, por convención: si el payload nombra una evaluación, un miembro o un elemento de alcance, es
 * sobre eso; si no, sobre la auditoría. Es lo que permite pedir "el historial de este criterio".
 */
export function subjectOf(payload: AuditEventPayload): { type: SubjectType; id: string } {
  if (payload.evaluationId) return { type: 'Evaluation', id: payload.evaluationId }
  if (payload.memberId) return { type: 'AuditMember', id: payload.memberId }
  if (payload.scopeItemId) return { type: 'ScopeItem', id: payload.scopeItemId }
  return { type: 'Audit', id: payload.auditId }
}
