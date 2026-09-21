import type { TemplateForAudit } from '../../library/index.js'
import type { ScoredLeaf } from '../domain/scoring.js'

interface ResultRow {
  controlId: string
  status: string
  isNotApplicable: boolean
  expectedLevel: { value: { toNumber(): number } } | null
  achievedLevel: { id: string; value: { toNumber(): number } } | null
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
  }))
}
