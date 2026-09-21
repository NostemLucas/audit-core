import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { leafGap } from '../../domain/scoring.js'
import { findEvaluations, toEvaluationViews } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { toScoredLeaves } from '../results.queries.js'

@Injectable()
export class ListGapsUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryReader,
  ) {}

  /** Los criterios por debajo de lo esperado, del más lejano al menos; a igual brecha, en orden de lectura de la plantilla. */
  async execute(actor: Actor, auditId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const template = await this.library.getTemplate(audit.templateId)
    const rows = await findEvaluations(this.db, auditId)
    const leaves = toScoredLeaves(rows, template)
    const gapById = new Map(rows.map((row, index) => [row.id, leafGap(leaves[index]!)] as const))
    return toEvaluationViews(
      rows.filter((row) => (gapById.get(row.id) ?? 0) < 0),
      template,
    )
      .map((view) => ({ ...view, gap: gapById.get(view.id)! }))
      .sort((a, b) => a.gap - b.gap) // estable: a igual brecha se conserva el orden de lectura
  }
}
