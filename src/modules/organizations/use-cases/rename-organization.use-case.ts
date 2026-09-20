import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { OrganizationErrors } from '../errors.js'
import { toOrganizationView } from '../organization.mapper.js'
import type { OrganizationViewT, UpdateOrganizationT } from '../organization.schemas.js'

@Injectable()
export class RenameOrganizationUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async execute(id: string, input: UpdateOrganizationT): Promise<OrganizationViewT> {
    const { count } = await this.tx.organization.updateMany({ where: { id }, data: { name: input.name } })
    if (count === 0) throw new DomainError(OrganizationErrors.ORGANIZATION_NOT_FOUND, { id })
    return toOrganizationView(await this.tx.organization.findUniqueOrThrow({ where: { id } }))
  }
}
