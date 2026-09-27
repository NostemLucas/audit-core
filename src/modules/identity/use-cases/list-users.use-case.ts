import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../platform/db/index.js'
import { page } from '../../../platform/http/index.js'
import { Role } from '../../../shared/enums.js'
import type { ListUsersQueryT } from '../user.schemas.js'

const SELECT = { id: true, name: true, username: true, email: true, roles: true } as const

@Injectable()
export class ListUsersUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(query: ListUsersQueryT) {
    const contains = query.q && { contains: query.q, mode: 'insensitive' as const }
    const where = {
      ...(contains && { OR: [{ name: contains }, { username: contains }, { email: contains }] }),
      ...(query.role && { roles: { has: query.role } }),
      ...(query.eligible && {
        AND: [{ OR: [{ roles: { has: Role.AUDITOR } }, { roles: { has: Role.GERENTE } }] }],
      }),
    }
    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }], // el id desempata: el orden es estable entre páginas
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.user.count({ where }),
    ])
    return page(rows, { page: query.page, pageSize: query.pageSize, total })
  }
}
