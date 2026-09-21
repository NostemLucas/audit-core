import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { AuditErrors } from '../domain/errors.js'
import type { TemplateForAudit } from '../../library/index.js'

/** Lo que la lista muestra de cada criterio, de las otras tablas: el responsable, los niveles y cuánta evidencia tiene. */
export const EVALUATION_INCLUDE = {
  assignedUser: { select: { id: true, name: true } },
  expectedLevel: { select: { id: true, value: true, label: true } },
  achievedLevel: { select: { id: true, value: true, label: true } },
  _count: { select: { evidences: { where: { deletedAt: null } } } },
} as const

/**
 * Las evaluaciones de una auditoría como lista plana en ORDEN DE LECTURA de la plantilla, cada una con su criterio y su
 * dominio. La jerarquía sale del árbol de `library` (una sola definición), no de nada que se recalcule aquí.
 */
export function toEvaluationViews<
  T extends { id: string; controlId: string; status: string; guidance: string | null; _count: { evidences: number } },
>(rows: readonly T[], template: TemplateForAudit) {
  const order = new Map(template.tree.readingOrder().map((node, index) => [node.id, index] as const))
  return [...rows]
    .sort((a, b) => (order.get(a.controlId) ?? 0) - (order.get(b.controlId) ?? 0))
    .map((row) => {
      const { _count, ...rest } = row
      const node = template.tree.pathTo(row.controlId).at(-1)!
      return {
        ...rest,
        evidenceCount: _count.evidences,
        control: {
          id: node.id,
          reference: node.reference,
          title: node.title,
          domain: template.tree.rootOf(row.controlId).title,
        },
      }
    })
}

export function findEvaluations(tx: Tx, auditId: string, where: object = {}) {
  return tx.evaluation.findMany({ where: { auditId, ...where }, include: EVALUATION_INCLUDE })
}

export async function loadEvaluation(tx: Tx, auditId: string, evaluationId: string) {
  const row = await tx.evaluation.findFirst({ where: { id: evaluationId, auditId }, include: EVALUATION_INCLUDE })
  if (!row) throw new DomainError(AuditErrors.EVALUATION_NOT_FOUND, { auditId, evaluationId })
  return row
}
