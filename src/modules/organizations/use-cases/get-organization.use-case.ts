import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { OrganizationErrors } from '../errors.js'

@Injectable()
export class GetOrganizationUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(id: string) {
    const row = await this.db.organization.findUnique({ where: { id } })
    if (!row) throw new DomainError(OrganizationErrors.ORGANIZATION_NOT_FOUND, { id })
    return row
  }
}
