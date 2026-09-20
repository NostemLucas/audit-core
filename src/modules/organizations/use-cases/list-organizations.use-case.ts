import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../platform/db/index.js'
import { type Page, page } from '../../../platform/http/index.js'
import { toOrganizationView } from '../organization.mapper.js'
import type { ListOrganizationsQueryT, OrganizationViewT } from '../organization.schemas.js'

@Injectable()
export class ListOrganizationsUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(query: ListOrganizationsQueryT): Promise<Page<OrganizationViewT>> {
    const where = {
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.active !== undefined && { isActive: query.active }),
    }
    const [rows, total] = await Promise.all([
      this.db.organization.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }], // el id desempata: el orden es estable entre páginas
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.organization.count({ where }),
    ])
    return page(rows.map(toOrganizationView), { page: query.page, pageSize: query.pageSize, total })
  }
}
