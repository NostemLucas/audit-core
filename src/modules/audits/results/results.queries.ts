import type { TemplateForAudit } from '../../library/index.js'
import type { EvaluationSeverity } from '../../../shared/enums.js'
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
  severity: EvaluationSeverity | null
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

/** Cuántas brechas hay de cada gravedad (las sin clasificar no cuentan en ninguna): resumen para el informe (docs/07 §2). */
export function countBySeverity(
  gaps: readonly { severity: EvaluationSeverity | null }[],
): Record<EvaluationSeverity, number> {
  const counts: Record<EvaluationSeverity, number> = { MAJOR: 0, MINOR: 0, OBSERVATION: 0 }
  for (const gap of gaps) if (gap.severity) counts[gap.severity] += 1
  return counts
}

/**
 * TODAS las hojas evaluadas (aplicables, con nivel alcanzado y esperado), en orden de lectura, con su resultado
 * completo — a diferencia de `computeGapViews`, que solo trae las que quedaron por debajo. Para un catálogo de
 * informe con "todos los resultados", no solo los fallos (docs/07 §2).
 */
export function computeResultViews(rows: readonly ResultRow[], template: TemplateForAudit) {
  const leaves = toScoredLeaves(rows, template)
  const gapById = new Map(rows.map((row, index) => [row.id, leafGap(leaves[index]!)] as const))
  return toEvaluationViews(
    rows.filter((row) => gapById.get(row.id) !== null),
    template,
  ).map((view) => ({ ...view, meetsExpected: gapById.get(view.id)! >= 0 }))
}

/**
 * TODOS los nodos de la plantilla (dominios, agrupadores y hojas), en orden de lectura — solo estructura, sin datos
 * de evaluación: para un informe que necesita mostrar la jerarquía completa (con o sin agrupadores), no un resultado
 * (docs/07 §2). Única fuente: el mismo árbol que usa el resto del sistema (`TemplateForAudit.tree`).
 */
export function computeControlViews(template: TemplateForAudit) {
  const { tree } = template
  return tree.readingOrder().map((node) => ({
    domain: tree.rootOf(node.id).title,
    reference: node.reference,
    title: node.title,
    depth: tree.depthOf(node.id),
    isLeaf: tree.isLeaf(node.id),
  }))
}
