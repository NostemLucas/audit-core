import type { TemplateForAudit } from '../../library/index.js'
import type { ScoredLeaf } from '../domain/scoring.js'
import { leafGap } from '../domain/scoring.js'
import { toEvaluationViews } from '../evaluation/evaluation.queries.js'

interface ResultRow {
  id: string
  controlId: string
  status: string
  guidance: string | null
  isNotApplicable: boolean
  carriedFromId: string | null
  findings: string | null
  expectedLevel: { label: string; value: { toNumber(): number } } | null
  achievedLevel: { id: string; label: string; value: { toNumber(): number } } | null
  _count: { evidences: number }
}

/** Cada criterio como lo ve `scoring` (una sola forma de leer las filas para resultados y brechas). El dominio es su raíz. */
export function toScoredLeaves(rows: readonly ResultRow[], template: TemplateForAudit): ScoredLeaf[] {
  return rows.map((row) => ({
    domainId: template.tree.rootOf(row.controlId).id,
    status: row.status,
    isNotApplicable: row.isNotApplicable,
    expected: row.expectedLevel?.value.toNumber() ?? null,
    achieved: row.achievedLevel?.value.toNumber() ?? null,
    achievedLevelId: row.achievedLevel?.id ?? null,
    carriedOver: row.carriedFromId !== null,
  }))
}

/**
 * Los criterios por debajo de lo esperado, con su brecha, del más lejano al menos (a igual brecha, orden de lectura de
 * la plantilla). ÚNICA fuente para `GET /gaps` y el informe (docs/07 §2: nada de un cálculo paralelo).
 */
export function computeGapViews(rows: readonly ResultRow[], template: TemplateForAudit) {
  const leaves = toScoredLeaves(rows, template)
  const gapById = new Map(rows.map((row, index) => [row.id, leafGap(leaves[index]!)] as const))
  return toEvaluationViews(
    rows.filter((row) => (gapById.get(row.id) ?? 0) < 0),
    template,
  )
    .map((view) => ({ ...view, gap: gapById.get(view.id)! }))
    .sort((a, b) => a.gap - b.gap)
}
