import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadEvaluation, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class GetEvaluationUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryReader,
  ) {}

  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const row = await loadEvaluation(this.db, auditId, evaluationId)
    return toEvaluationViews([row], await this.library.getTemplate(audit.templateId))[0]!
  }
}
