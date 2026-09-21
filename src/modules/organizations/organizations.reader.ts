import { Injectable } from '@nestjs/common'
import { InjectTx, type Tx } from '../../platform/db/index.js'
import { DomainError } from '../../platform/errors/index.js'
import { OrganizationErrors } from './errors.js'

/**
 * API pública de solo lectura para otros módulos (`audits`). Es la única forma en que otro módulo pregunta por una
 * organización: no importa nada interno de este módulo.
 */
@Injectable()
export class OrganizationsReader {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** La organización si existe y se puede elegir para auditorías nuevas (docs/03 §3); si no, el error que corresponde. */
  async getActive(id: string): Promise<{ id: string; name: string }> {
    const organization = await this.tx.organization.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    })
    if (!organization) throw new DomainError(OrganizationErrors.ORGANIZATION_NOT_FOUND, { id })
    if (!organization.isActive) throw new DomainError(OrganizationErrors.ORGANIZATION_INACTIVE, { id })
    return { id: organization.id, name: organization.name }
  }
}
