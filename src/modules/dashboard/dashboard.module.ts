import { Module } from '@nestjs/common'
import { LibraryModule } from '../library/index.js'
import { DashboardController } from './dashboard.controller.js'
import { GetDashboardSummaryUseCase } from './use-cases/get-dashboard-summary.use-case.js'
import { GetMyWorkUseCase } from './use-cases/get-my-work.use-case.js'

@Module({
  imports: [LibraryModule],
  controllers: [DashboardController],
  providers: [GetDashboardSummaryUseCase, GetMyWorkUseCase],
})
export class DashboardModule {}
