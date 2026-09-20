import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { OrganizationErrors } from '../errors.js'
import { toOrganizationView } from '../organization.mapper.js'
import type { OrganizationViewT } from '../organization.schemas.js'

/**
 * Activar y desactivar (docs/03 §3): "se puede elegir para auditorías NUEVAS". Idempotente; no toca lo existente.
 * Un solo caso de uso con el valor como parámetro: la única diferencia entre ambos es ese booleano.
 */
@Injectable()
export class SetOrganizationAvailabilityUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async execute(id: string, isActive: boolean): Promise<OrganizationViewT> {
    const { count } = await this.tx.organization.updateMany({ where: { id }, data: { isActive } })
    if (count === 0) throw new DomainError(OrganizationErrors.ORGANIZATION_NOT_FOUND, { id })
    return toOrganizationView(await this.tx.organization.findUniqueOrThrow({ where: { id } }))
  }
}
