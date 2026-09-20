import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../platform/db/index.js'
import type { CreateOrganizationT } from '../organization.schemas.js'

@Injectable()
export class CreateOrganizationUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Un nombre repetido lo rechaza la BD (UNIQUE) y sale como ORGANIZATION_NAME_TAKEN. */
  @Transactional()
  async execute(input: CreateOrganizationT) {
    return await this.tx.organization.create({ data: { name: input.name } })
  }
}
