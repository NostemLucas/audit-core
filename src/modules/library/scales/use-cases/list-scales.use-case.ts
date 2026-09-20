import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { page } from '../../../../platform/http/index.js'
import type { ListScalesQueryT } from '../scale.schemas.js'
import { WITH_LEVELS } from '../scale.queries.js'

@Injectable()
export class ListScalesUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(query: ListScalesQueryT) {
    const where = {
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.active !== undefined && { isActive: query.active }),
    }
    const [rows, total] = await Promise.all([
      this.db.scale.findMany({
        where,
        include: WITH_LEVELS,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.scale.count({ where }),
    ])
    return page(rows, { page: query.page, pageSize: query.pageSize, total })
  }
}
