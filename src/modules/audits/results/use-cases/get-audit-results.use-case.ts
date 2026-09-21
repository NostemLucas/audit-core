import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { computeResults } from '../../domain/scoring.js'
import { findEvaluations } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { toScoredLeaves } from '../results.queries.js'

@Injectable()
export class GetAuditResultsUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryReader,
  ) {}

  /** Los ven todos los que ven la auditoría. En curso son provisionales: `progress` dice cuánto está aprobado. */
  async execute(actor: Actor, auditId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const [template, scale, rows] = await Promise.all([
      this.library.getTemplate(audit.templateId),
      this.library.getScale(audit.scaleId),
      findEvaluations(this.db, auditId),
    ])
    const roots = template.tree.roots()
    const results = computeResults(
      toScoredLeaves(rows, template),
      roots.map((root) => root.id),
      scale.levels,
    )
    return {
      progress: results.progress,
      overall: results.overall,
      domains: results.domains.map(({ domainId, ...domain }, index) => ({
        domain: { id: domainId, title: roots[index]!.title },
        ...domain,
      })),
    }
  }
}
