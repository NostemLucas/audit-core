import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { findEvaluations } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { computeGapViews } from '../results.queries.js'

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
    return computeGapViews(rows, template)
  }
}
