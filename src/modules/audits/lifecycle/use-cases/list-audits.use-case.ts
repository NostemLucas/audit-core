import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { page } from '../../../../platform/http/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { accessesOf, AUDIT_INCLUDE, visibleAuditsWhere } from '../../infrastructure/audit.queries.js'
import { withAccess } from '../audit.presenter.js'
import type { ListAuditsQueryT } from '../audit.schemas.js'

@Injectable()
export class ListAuditsUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(actor: Actor, query: ListAuditsQueryT) {
    // `mine` fuerza el filtro de participación aunque el rol vea todas (docs/06 §1); si no, `visibleAuditsWhere`.
    const participates = { OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] }
    const where = {
      ...(query.mine ? participates : visibleAuditsWhere(actor)),
      ...(query.status && { status: query.status }),
      ...(query.organizationId && { organizationId: query.organizationId }),
      ...(query.memberId && { members: { some: { userId: query.memberId } } }),
      ...(query.q && {
        AND: [
          {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
            ],
          },
        ],
      }),
    }
    const [rows, total] = await Promise.all([
      this.db.audit.findMany({
        where,
        include: AUDIT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.audit.count({ where }),
    ])
    const accesses = await accessesOf(this.db, actor, rows)
    return page(
      rows.map((row) => withAccess(row, actor, accesses.get(row.id)!)),
      { page: query.page, pageSize: query.pageSize, total },
    )
  }
}
