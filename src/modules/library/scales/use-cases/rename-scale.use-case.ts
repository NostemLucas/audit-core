import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { loadScale } from '../scale.queries.js'
import type { UpdateScaleT } from '../scale.schemas.js'

@Injectable()
export class RenameScaleUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async execute(id: string, input: UpdateScaleT) {
    await loadScale(this.tx, id)
    await this.tx.scale.update({ where: { id }, data: { name: input.name } })
    return loadScale(this.tx, id)
  }
}
