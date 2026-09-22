import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadEvaluation } from '../../evaluation/evaluation.queries.js'
import { listEvidence } from '../evidence.queries.js'

@Injectable()
export class ListEvidenceUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Quien ve el criterio ve su evidencia (misma regla que `GET` del criterio). */
  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    await loadEvaluation(this.db, auditId, evaluationId)
    return listEvidence(this.db, evaluationId)
  }
}
