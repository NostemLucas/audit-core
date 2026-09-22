import { Inject, Injectable } from '@nestjs/common'
import { type AuthenticatedUser } from '../../../platform/auth/index.js'
import { CLOCK, type Clock } from '../../../platform/clock/index.js'
import { DB, type Db } from '../../../platform/db/index.js'
import { AuditStatus } from '../../../shared/enums.js'
import { LIMITS } from '../../../shared/limits.js'
import { visibleAuditsWhere } from '../../audits/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

@Injectable()
export class GetDashboardSummaryUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Panorama de lo que el actor puede ver (docs/08 §1): mismo alcance que `GET /audits` (`visibleAuditsWhere`). */
  async execute(actor: AuthenticatedUser) {
    const visible = visibleAuditsWhere(actor)
    const now = this.clock.now()
    const upcomingCutoff = new Date(now.getTime() + LIMITS.dashboardUpcomingDays * DAY_MS)

    const [grouped, pendingReview, overdue, upcoming] = await Promise.all([
      this.db.audit.groupBy({ by: ['status'], where: visible, _count: true }),
      this.db.evaluation.count({ where: { status: 'COMPLETED', audit: visible } }),
      this.db.audit.count({ where: { ...visible, status: 'IN_PROGRESS', plannedEnd: { lt: now } } }),
      this.db.audit.count({
        where: { ...visible, status: 'IN_PROGRESS', plannedEnd: { gte: now, lte: upcomingCutoff } },
      }),
    ])

    const countByStatus = new Map(grouped.map((row) => [row.status, row._count] as const))
    const statuses = Object.values(AuditStatus)
    const byStatus = Object.fromEntries(statuses.map((status) => [status, countByStatus.get(status) ?? 0])) as Record<
      (typeof statuses)[number],
      number
    >

    return {
      audits: { total: grouped.reduce((sum, row) => sum + row._count, 0), byStatus },
      evaluations: { pendingReview },
      deadlines: { overdue, upcoming },
    }
  }
}
