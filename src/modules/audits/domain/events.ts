import { z } from 'zod'
// Import directo del archivo puro: el `index` de platform/events arrastra el bus (Nest) y `domain/` no puede importar Nest.
import { defineEvents } from '../../../platform/events/define-events.js'
import { AuditRole } from '../../../shared/enums.js'

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
  AuditCreated: z.object({ ...audit, code: z.string(), name: z.string() }),
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
