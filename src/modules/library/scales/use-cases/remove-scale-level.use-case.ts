import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { assertLevelsValid, assertStructureEditable, loadScale } from '../scale.queries.js'

@Injectable()
export class RemoveScaleLevelUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async execute(scaleId: string, levelId: string) {
    const scale = await loadScale(this.tx, scaleId)
    if (!scale.levels.some((level) => level.id === levelId)) {
      throw new DomainError(LibraryErrors.SCALE_LEVEL_NOT_FOUND, { scaleId, levelId })
    }
    await assertStructureEditable(this.tx, scaleId)
    const findings = await this.tx.suggestedFinding.count({ where: { levelId } })
    if (findings > 0) {
      throw new DomainError(LibraryErrors.SCALE_LEVEL_IN_USE, {
        scaleId,
        levelId,
        reason: 'SUGGESTED_FINDINGS',
        findings,
      })
    }
    assertLevelsValid(
      scale.levels.filter((level) => level.id !== levelId).map((l) => ({ value: l.value.toNumber(), label: l.label })),
    )

    await this.tx.scaleLevel.delete({ where: { id: levelId } })
    return loadScale(this.tx, scaleId)
  }
}
