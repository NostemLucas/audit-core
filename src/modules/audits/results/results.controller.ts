import { Controller, Get, Param } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import { AuditResultsView, GapView } from './results.schemas.js'
import { GetAuditResultsUseCase } from './use-cases/get-audit-results.use-case.js'
import { ListGapsUseCase } from './use-cases/list-gaps.use-case.js'

/** Lecturas derivadas de los criterios (3e): cómo va la auditoría y qué criterios no llegaron a lo esperado. (Tier C, docs/02 §4) */
@Controller('audits/:auditId')
export class ResultsController {
  constructor(
    private readonly resultsUseCase: GetAuditResultsUseCase,
    private readonly gapsUseCase: ListGapsUseCase,
  ) {}

  @Get('results')
  @Can('read', 'Audit')
  @Responds(AuditResultsView)
  results(@CurrentUser() actor: AuthenticatedUser, @Param('auditId', { schema: AuditId }) auditId: string) {
    return this.resultsUseCase.execute(actor, auditId)
  }

  @Get('gaps')
  @Can('read', 'Audit')
  @Responds(GapView, { kind: 'list' })
  gaps(@CurrentUser() actor: AuthenticatedUser, @Param('auditId', { schema: AuditId }) auditId: string) {
    return this.gapsUseCase.execute(actor, auditId)
  }
}
