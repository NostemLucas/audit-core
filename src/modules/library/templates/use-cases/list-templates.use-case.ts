import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { page } from '../../../../platform/http/index.js'
import type { ListTemplatesQueryT } from '../template.schemas.js'
import { WITH_CONTROL_COUNT, withActions } from '../template.queries.js'

@Injectable()
export class ListTemplatesUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(query: ListTemplatesQueryT) {
    const where = {
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.status && { status: query.status }),
    }
    const [rows, total] = await Promise.all([
      this.db.template.findMany({
        where,
        include: WITH_CONTROL_COUNT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.template.count({ where }),
    ])
    return page(rows.map(withActions), { page: query.page, pageSize: query.pageSize, total })
  }
}
