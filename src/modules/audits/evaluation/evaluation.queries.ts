import { type Tx } from '../../../platform/db/index.js'
import type { TemplateForAudit } from '../../library/index.js'

/** Lo que la lista muestra de cada criterio, de las otras tablas: el responsable y el nivel esperado. */
export const EVALUATION_INCLUDE = {
  assignedUser: { select: { id: true, name: true } },
  expectedLevel: { select: { id: true, value: true, label: true } },
} as const

/**
 * Las evaluaciones de una auditoría como lista plana en ORDEN DE LECTURA de la plantilla, cada una con su criterio y su
 * dominio. La jerarquía sale del árbol de `library` (una sola definición), no de nada que se recalcule aquí.
 */
export function toEvaluationViews<T extends { id: string; controlId: string; status: string; guidance: string | null }>(
  rows: readonly T[],
  template: TemplateForAudit,
) {
  const order = new Map(template.tree.readingOrder().map((node, index) => [node.id, index] as const))
  return [...rows]
    .sort((a, b) => (order.get(a.controlId) ?? 0) - (order.get(b.controlId) ?? 0))
    .map((row) => {
      const node = template.tree.pathTo(row.controlId).at(-1)!
      return {
        ...row,
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
