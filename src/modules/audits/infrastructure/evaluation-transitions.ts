import type { Prisma } from '../../../generated/prisma/client.js'
import { type Tx } from '../../../platform/db/index.js'
import { EvaluationStatus } from '../../../shared/enums.js'
import { evaluationLifecycle, type EvaluationEvent } from '../domain/evaluation.lifecycle.js'

/**
 * Aplica un evento del ciclo de vida de `Evaluation` de forma ATÓMICA: el `UPDATE` lleva el estado leído (`from`) en
 * el `WHERE`, así que si otra transacción ya movió el criterio a otro estado, esta pierde la carrera (`count === 0`)
 * en vez de pisarla — dos transiciones simultáneas (p. ej. aprobar y devolver el mismo criterio) ya no pueden pasar
 * las dos. Al perder, se relee el estado real y se le pide `next()` de nuevo: lanza el mismo `EVALUATION_INVALID_STATE`,
 * pero con el estado que de verdad tiene ahora, no el que el caso de uso leyó al empezar.
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
    evaluationLifecycle.next(fresh.status, event)
  }
  return to
}
