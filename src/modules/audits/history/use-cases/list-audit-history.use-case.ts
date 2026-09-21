import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { page } from '../../../../platform/http/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { EVENT_INCLUDE, toEventView } from '../history.queries.js'
import type { ListHistoryQueryT } from '../history.schemas.js'

@Injectable()
export class ListAuditHistoryUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Todo lo ocurrido en la auditoría, lo más reciente primero. Lo ven todos los que ven la auditoría. */
  async execute(actor: Actor, auditId: string, query: ListHistoryQueryT) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const [rows, total] = await Promise.all([
      this.db.auditEvent.findMany({
        where: { auditId },
        include: EVENT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.auditEvent.count({ where: { auditId } }),
    ])
    return page(rows.map(toEventView), { page: query.page, pageSize: query.pageSize, total })
  }
}
