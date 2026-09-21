import { Controller, Get, Param, Query } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { EvaluationId } from '../evaluation/evaluation.schemas.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import { AuditEventView, EvaluationHistoryEntry, ListHistoryQuery, type ListHistoryQueryT } from './history.schemas.js'
import { GetEvaluationHistoryUseCase } from './use-cases/get-evaluation-history.use-case.js'
import { ListAuditHistoryUseCase } from './use-cases/list-audit-history.use-case.js'

/** Historial de la auditoría y de cada criterio: se lee de `audit_events`, el único mecanismo de historia (docs/06 §4). */
@Controller('audits/:auditId')
export class HistoryController {
  constructor(
    private readonly auditHistory: ListAuditHistoryUseCase,
    private readonly evaluationHistory: GetEvaluationHistoryUseCase,
  ) {}

  @Get('history')
  @Can('read', 'Audit')
  @Responds(AuditEventView, { kind: 'page' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Query({ schema: ListHistoryQuery }) query: ListHistoryQueryT,
  ) {
    return this.auditHistory.execute(actor, auditId, query)
  }

  @Get('evaluations/:evaluationId/history')
  @Can('read', 'Evaluation')
  @Responds(EvaluationHistoryEntry, { kind: 'list' })
  ofEvaluation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
  ) {
    return this.evaluationHistory.execute(actor, auditId, evaluationId)
  }
}
