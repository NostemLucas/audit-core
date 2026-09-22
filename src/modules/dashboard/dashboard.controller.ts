import { Controller, Get } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../platform/auth/index.js'
import { Can } from '../../platform/authz/index.js'
import { Responds } from '../../platform/http/index.js'
import { DashboardSummaryView, MyWorkView } from './dashboard.schemas.js'
import { GetDashboardSummaryUseCase } from './use-cases/get-dashboard-summary.use-case.js'
import { GetMyWorkUseCase } from './use-cases/get-my-work.use-case.js'

/** Solo lectura, cruzando auditorías (docs/08): nunca escribe, no tiene `domain/` propio (Tier C). */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly summaryUseCase: GetDashboardSummaryUseCase,
    private readonly myWorkUseCase: GetMyWorkUseCase,
  ) {}

  @Get('summary')
  @Can('read', 'Dashboard')
  @Responds(DashboardSummaryView)
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.summaryUseCase.execute(actor)
  }

  @Get('my-work')
  @Can('read', 'Dashboard')
  @Responds(MyWorkView)
  myWork(@CurrentUser() actor: AuthenticatedUser) {
    return this.myWorkUseCase.execute(actor)
  }
}
