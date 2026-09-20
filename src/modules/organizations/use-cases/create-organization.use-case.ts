import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../platform/db/index.js'
import { toOrganizationView } from '../organization.mapper.js'
import type { CreateOrganizationT, OrganizationViewT } from '../organization.schemas.js'

@Injectable()
export class CreateOrganizationUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Un nombre repetido lo rechaza la BD (UNIQUE) y sale como ORGANIZATION_NAME_TAKEN. */
  @Transactional()
  async execute(input: CreateOrganizationT): Promise<OrganizationViewT> {
    return toOrganizationView(await this.tx.organization.create({ data: { name: input.name } }))
  }
}
