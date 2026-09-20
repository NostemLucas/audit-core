import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { OrganizationErrors } from '../errors.js'

@Injectable()
export class DeleteOrganizationUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Con auditorías, la FK (Restrict) lo impide y sale como ORGANIZATION_IN_USE: se desactiva en su lugar. */
  @Transactional()
  async execute(id: string): Promise<void> {
    const { count } = await this.tx.organization.deleteMany({ where: { id } })
    if (count === 0) throw new DomainError(OrganizationErrors.ORGANIZATION_NOT_FOUND, { id })
  }
}
