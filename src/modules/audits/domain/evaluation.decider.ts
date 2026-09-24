import type { EventDef } from '../../../platform/events/define-events.js'
import { DomainError } from '../../../platform/errors/index.js'
import type { AuditStatus, EvaluationSeverity, EvaluationStatus, ScaleDimension } from '../../../shared/enums.js'
import { assertAuditEvaluable } from './audit.lifecycle.js'
import { type Actor, type AuditAccess, assertCanEvaluate, assertOnAudit } from './audit-policy.js'
import { AuditErrors } from './errors.js'
import { missingForCompletion } from './evaluation-completion.js'
import { evaluationLifecycle } from './evaluation.lifecycle.js'
import { AuditEvents } from './events.js'

/**
 * Las decisiones sobre UN criterio (docs/02 §4, "decider"). Función PURA por comando: recibe el estado ya cargado y
 * devuelve qué escribir y qué evento publicar, o lanza el error de negocio. No lee ni escribe nada: eso lo hace
 * `EvaluationStore`, UNA vez para todos los comandos (candado, compare-and-swap por versión, publicación).
 *
 * Aquí viven juntas las reglas que antes cada caso de uso repetía a mano, en el mismo orden: la auditoría en curso,
 * quién puede actuar, la transición del ciclo de vida y lo que exige cada comando. Un comando nuevo no puede
 * "olvidarse" de ninguna: no hay otra forma de escribir una transición que pasar por aquí y por el store.
 */
export interface EvaluationState {
  readonly auditId: string
  readonly evaluationId: string
  readonly controlTitle: string
  readonly auditStatus: AuditStatus
  /** El acceso del actor a ESTA auditoría (manager y rol en el equipo). */
  readonly access: AuditAccess
  readonly status: EvaluationStatus
  readonly assignedUserId: string | null
  readonly content: {
    readonly achievedLevelId: string | null
    readonly isNotApplicable: boolean
    readonly notApplicableReason: string | null
    readonly findings: string | null
    readonly severity: EvaluationSeverity | null
    readonly notes: string | null
  }
  /** Los niveles ya resueltos contra la escala de la auditoría (puntajes como número). */
  readonly scale: {
    readonly dimension: ScaleDimension
    readonly minimum: number
    readonly expected: number | null
    readonly achieved: { readonly value: number; readonly label: string } | null
  }
  /** La evidencia vigente (sin las borradas): se cuenta para completar y se copia en el evento. */
  readonly evidence: ReadonlyArray<{ readonly id: string; readonly title: string }>
}

/** Un evento ya validado en tipos al construirlo (`emit`); el store solo lo publica. */
export interface DecidedEvent {
  readonly def: EventDef
  readonly payload: unknown
}

export interface EvaluationDecision {
  readonly to: EvaluationStatus
  /** Columnas que el comando cambia además del estado. */
  readonly patch: { readonly requiresFollowUp?: boolean; readonly carriedFromId?: null }
  readonly event: DecidedEvent
}

const emit = <N extends string, P>(def: EventDef<N, P>, payload: P): DecidedEvent => ({
  def: def as unknown as EventDef,
  payload,
})

const subject = (s: EvaluationState) => ({
  auditId: s.auditId,
  evaluationId: s.evaluationId,
  controlTitle: s.controlTitle,
})

/** Lo que exige toda acción del LÍDER sobre un criterio: auditoría en curso y ser su líder. */
function asLead(s: EvaluationState, actor: Actor): void {
  assertAuditEvaluable(s.auditStatus)
  assertOnAudit('lead', actor, s.access)
}

/** El auditor asignado envía el criterio a revisión, con lo que la escala exige (docs/06 §3). */
export function completeEvaluation(s: EvaluationState, actor: Actor): EvaluationDecision {
  assertAuditEvaluable(s.auditStatus)
  assertCanEvaluate(actor, s.access, s.assignedUserId)
  const to = evaluationLifecycle.next(s.status, 'COMPLETE') // antes de exigir contenido: el estado manda

  const missing = missingForCompletion(
    s.content,
    {
      expected: { value: s.scale.expected ?? 0 },
      achieved: s.scale.achieved,
      minimum: { value: s.scale.minimum },
    },
    s.evidence.length,
    s.scale.dimension,
  )
  if (missing.length > 0) throw new DomainError(AuditErrors.EVALUATION_INCOMPLETE, { missing })

  return {
    to,
    patch: {},
    // Copia de lo enviado (docs/06 §4): la historia del criterio muestra qué se revisó, aunque después cambie.
    event: emit(AuditEvents.EvaluationCompleted, {
      ...subject(s),
      achievedLevelLabel: s.scale.achieved?.label ?? null,
      isNotApplicable: s.content.isNotApplicable,
      notApplicableReason: s.content.notApplicableReason,
      findings: s.content.findings,
      severity: s.content.severity,
      notes: s.content.notes,
      evidence: s.evidence.map(({ id, title }) => ({ id, title })),
    }),
  }
}

/** El líder aprueba un criterio enviado; puede pedir que se revise de nuevo en el próximo seguimiento (docs/06 §9). */
export function approveEvaluation(
  s: EvaluationState,
  actor: Actor,
  input: { readonly comments: string | null; readonly requiresFollowUp: boolean },
): EvaluationDecision {
  asLead(s, actor)
  return {
    to: evaluationLifecycle.next(s.status, 'APPROVE'),
    patch: { requiresFollowUp: input.requiresFollowUp },
    event: emit(AuditEvents.EvaluationApproved, {
      ...subject(s),
      comments: input.comments,
      requiresFollowUp: input.requiresFollowUp,
    }),
  }
}

/** El líder devuelve un criterio enviado, con comentario obligatorio: vuelve a ser editable. */
export function returnEvaluation(
  s: EvaluationState,
  actor: Actor,
  input: { readonly comments: string },
): EvaluationDecision {
  asLead(s, actor)
  return {
    to: evaluationLifecycle.next(s.status, 'RETURN'),
    patch: {},
    event: emit(AuditEvents.EvaluationReturned, { ...subject(s), comments: input.comments }),
  }
}

/**
 * El líder reabre un criterio aprobado (excepcional, con comentario). Reabrir uno trasladado lo vuelve a evaluar AQUÍ:
 * deja de ser un traslado (docs/06 §9).
 */
export function reopenEvaluation(
  s: EvaluationState,
  actor: Actor,
  input: { readonly comments: string },
): EvaluationDecision {
  asLead(s, actor)
  return {
    to: evaluationLifecycle.next(s.status, 'REOPEN'),
    patch: { carriedFromId: null },
    event: emit(AuditEvents.EvaluationReopened, { ...subject(s), comments: input.comments }),
  }
}
