import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { loadScale } from '../scale.queries.js'

/** Activar y desactivar (docs/03 §3): "se puede elegir para auditorías NUEVAS". Idempotente. */
@Injectable()
export class SetScaleAvailabilityUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async execute(id: string, isActive: boolean) {
    await loadScale(this.tx, id)
    await this.tx.scale.update({ where: { id }, data: { isActive } })
    return loadScale(this.tx, id)
  }
}
