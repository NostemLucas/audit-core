import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { assertLevelsValid, assertStructureEditable, loadScale } from '../scale.queries.js'
import type { UpdateScaleLevelT } from '../scale.schemas.js'

@Injectable()
export class UpdateScaleLevelUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Etiqueta y descripción siempre se corrigen; cambiar el puntaje solo mientras ninguna auditoría use la escala. */
  @Transactional()
  async execute(scaleId: string, levelId: string, input: UpdateScaleLevelT) {
    const scale = await loadScale(this.tx, scaleId)
    const current = scale.levels.find((level) => level.id === levelId)
    if (!current) throw new DomainError(LibraryErrors.SCALE_LEVEL_NOT_FOUND, { scaleId, levelId })

    if (input.value !== undefined && input.value !== current.value.toNumber()) {
      await assertStructureEditable(this.tx, scaleId)
    }
    assertLevelsValid(
      scale.levels.map((level) =>
        level.id === levelId
          ? { value: input.value ?? level.value.toNumber(), label: input.label ?? level.label }
          : { value: level.value.toNumber(), label: level.label },
      ),
    )

    await this.tx.scaleLevel.update({
      where: { id: levelId },
      data: {
        ...(input.value !== undefined && { value: input.value }),
        ...(input.label !== undefined && { label: input.label }),
        ...(input.description !== undefined && { description: input.description }),
      },
    })
    return loadScale(this.tx, scaleId)
  }
}
