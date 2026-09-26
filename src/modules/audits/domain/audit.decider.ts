import type { EventDef } from '../../../platform/events/define-events.js'
import { DomainError } from '../../../platform/errors/index.js'
import type { AuditStatus } from '../../../shared/enums.js'
import { auditLifecycle } from './audit.lifecycle.js'
import { type Actor, type AuditAccess, assertOnAudit } from './audit-policy.js'
import { AuditErrors } from './errors.js'
import { AuditEvents } from './events.js'

/**
 * Las decisiones sobre LA auditoría (arrancar, cerrar — docs/02 §4, "decider"). Función PURA por comando: recibe el
 * estado ya cargado y devuelve qué escribir y qué evento publicar, o lanza el error de negocio. No lee ni escribe
 * nada: eso lo hace `AuditStore`, una vez para los dos comandos (candado, compare-and-swap por versión, publicación,
 * y el efecto en Nextcloud que solo `closeAudit` pide).
 *
 * `archiveAudit` y `transferAudit` NO están acá, a propósito: archivar no tiene ninguna precondición más que el
 * ciclo de vida mismo, y transferir ni siquiera usa `AuditStatus` (docs/02 §5: el decider se justifica donde hay
 * estados + permisos contextuales + concurrencia real — ninguno de los dos la tiene). Se quedan como casos de uso
 * directos.
 */
export interface AuditState {
  readonly auditId: string
  readonly status: AuditStatus
  /** El acceso del actor a esta auditoría (manager y rol en el equipo). */
  readonly access: AuditAccess
  /** Solo los usa `startAudit`. */
  readonly leadCount: number
  readonly memberCount: number
  readonly missingExpectedLevel: number
  readonly unassignedEvaluations: number
  /** Solo lo usa `closeAudit`. */
  readonly pendingEvaluations: number
}

/** Un evento ya validado en tipos al construirlo (`emit`); el store solo lo publica. */
export interface DecidedEvent {
  readonly def: EventDef
  readonly payload: unknown
}

export interface AuditDecision {
  readonly to: AuditStatus
  readonly event: DecidedEvent
  /** Solo `closeAudit`: el store debe bajar los informes del equipo a solo lectura DESPUÉS de escribir (docs/07 §1.5).
   * Dato puro (un booleano), no la llamada en sí — el decider no hace I/O. */
  readonly lockTeamReports?: boolean
}

const emit = <N extends string, P>(def: EventDef<N, P>, payload: P): DecidedEvent => ({
  def: def as unknown as EventDef,
  payload,
})

/**
 * Orden fijo (docs/03 §2.3 regla 4): primero el ciclo de vida, luego cada precondición con su propio 422 (docs/06 §2):
 * un líder, al menos un auditor, nivel esperado en todas las hojas (en CONFORMITY ya viene fijado al crear) y todos
 * los criterios asignados.
 */
export function startAudit(s: AuditState, actor: Actor): AuditDecision {
  assertOnAudit('manage', actor, s.access)
  const to = auditLifecycle.next(s.status, 'START')

  if (s.leadCount === 0) throw new DomainError(AuditErrors.AUDIT_HAS_NO_LEAD, { auditId: s.auditId })
  if (s.memberCount === 0) throw new DomainError(AuditErrors.AUDIT_HAS_NO_MEMBERS, { auditId: s.auditId })
  if (s.missingExpectedLevel > 0) {
    throw new DomainError(AuditErrors.AUDIT_EXPECTED_LEVELS_MISSING, { missing: s.missingExpectedLevel })
  }
  if (s.unassignedEvaluations > 0) {
    throw new DomainError(AuditErrors.AUDIT_UNASSIGNED_EVALUATIONS, { missing: s.unassignedEvaluations })
  }

  return { to, event: emit(AuditEvents.AuditStarted, { auditId: s.auditId }) }
}

/**
 * Exige todos los criterios APROBADOS, incluidos los «no aplica» (docs/06 §10). `lockTeamReports: true` es el único
 * dato extra: el store baja los informes del equipo a solo lectura en Nextcloud DESPUÉS de escribir `CLOSED` — ya no
 * hay razón legítima para seguir editando el consolidado final.
 */
export function closeAudit(s: AuditState, actor: Actor): AuditDecision {
  assertOnAudit('manage', actor, s.access)
  const to = auditLifecycle.next(s.status, 'CLOSE')

  if (s.pendingEvaluations > 0) {
    throw new DomainError(AuditErrors.AUDIT_HAS_PENDING_EVALUATIONS, { pending: s.pendingEvaluations })
  }

  return { to, event: emit(AuditEvents.AuditClosed, { auditId: s.auditId }), lockTeamReports: true }
}
