import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { assertLevelsValid, assertStructureEditable, loadScale, lockScale } from '../scale.queries.js'
import type { AddScaleLevelT } from '../scale.schemas.js'

@Injectable()
export class AddScaleLevelUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async execute(scaleId: string, input: AddScaleLevelT) {
    await lockScale(this.tx, scaleId)
    const scale = await loadScale(this.tx, scaleId)
    await assertStructureEditable(this.tx, scaleId)
    assertLevelsValid([...scale.levels.map((l) => ({ value: l.value.toNumber(), label: l.label })), input])

    await this.tx.scaleLevel.create({
      data: { scaleId, value: input.value, label: input.label, description: input.description ?? null },
    })
    return loadScale(this.tx, scaleId)
  }
}
