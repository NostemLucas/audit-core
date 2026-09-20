import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { assertLevelsValid, WITH_LEVELS } from '../scale.queries.js'
import type { CreateScaleT } from '../scale.schemas.js'

@Injectable()
export class CreateScaleUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** La escala nace con sus opciones (nunca existe una escala sin ellas). Un nombre repetido lo rechaza la BD. */
  @Transactional()
  async execute(input: CreateScaleT) {
    assertLevelsValid(input.levels)
    return this.tx.scale.create({
      data: { name: input.name, dimension: input.dimension, levels: { create: input.levels } },
      include: WITH_LEVELS,
    })
  }
}
