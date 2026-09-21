import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { loadEvaluation } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { EVENT_INCLUDE, toEventView } from '../history.queries.js'

@Injectable()
export class GetEvaluationHistoryUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** La historia de un criterio en orden cronológico: asignaciones, envíos (con su copia), devoluciones y aprobaciones. */
  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    await loadEvaluation(this.db, auditId, evaluationId) // 404 si no es de esta auditoría
    const rows = await this.db.auditEvent.findMany({
      where: { auditId, subjectType: 'Evaluation', subjectId: evaluationId },
      include: EVENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => ({ ...toEventView(row), payload: row.payload as Record<string, unknown> }))
  }
}
