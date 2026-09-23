import type { Prisma } from '../../../generated/prisma/client.js'
import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { EvaluationStatus } from '../../../shared/enums.js'
import { evaluationLifecycle, type EvaluationEvent } from '../domain/evaluation.lifecycle.js'
import { AuditErrors } from '../domain/errors.js'

/**
 * Aplica un evento del ciclo de vida de `Evaluation` de forma ATÓMICA: el `UPDATE` lleva el estado leído (`from`) en
 * el `WHERE`, así que si otra transacción ya movió el criterio a otro estado, esta pierde la carrera (`count === 0`)
 * en vez de pisarla — dos transiciones simultáneas (p. ej. aprobar y devolver el mismo criterio) ya no pueden pasar
 * las dos.
 *
 * Perder la carrera SIEMPRE lanza `EVALUATION_INVALID_STATE`, sin excepción — incluso si el estado fresco (releído
 * para el mensaje de error) también admitiría el mismo evento. Ese caso es un ABA real (p. ej. `IN_PROGRESS` →
 * `COMPLETED` → `RETURNED` entre que esta llamada leyó `from` y escribió: `RETURNED` también admite `COMPLETE`, el
 * mismo evento que se pidió) — si aquí se dejara pasar, la función devolvería éxito sin haber tocado la fila: un
 * falso positivo. Perder la carrera es perderla, aunque la revancha también fuera válida; quien llama debe releer y
 * reintentar, nunca asumir que `to` se escribió porque no hubo excepción.
 */
export async function transitionEvaluation(
  tx: Tx,
  evaluationId: string,
  from: EvaluationStatus,
  event: EvaluationEvent,
  data: Omit<Prisma.EvaluationUncheckedUpdateManyInput, 'status'> = {},
): Promise<EvaluationStatus> {
  const to = evaluationLifecycle.next(from, event)
  const { count } = await tx.evaluation.updateMany({
    where: { id: evaluationId, status: from },
    data: { ...data, status: to },
  })
  if (count === 0) {
    const fresh = await tx.evaluation.findUniqueOrThrow({ where: { id: evaluationId }, select: { status: true } })
    evaluationLifecycle.next(fresh.status, event) // lanza si el estado fresco tampoco admite el evento (el caso común)
    // Si no lanzó (ABA: el fresco SÍ admite el evento, pero esta llamada no fue la que escribió) falla igual, a propósito.
    throw new DomainError(AuditErrors.EVALUATION_INVALID_STATE, { entity: 'EVALUATION', from: fresh.status, event })
  }
  return to
}
