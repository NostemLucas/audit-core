import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'
import type { SetSuggestedFindingT } from '../suggested-finding.schemas.js'
import { loadControls, lockTemplate } from '../template.queries.js'

@Injectable()
export class SetSuggestedFindingUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Crea o reemplaza el texto sugerido de (control, opción). Se permite en cualquier estado de la plantilla: el texto se
   * copia al hallazgo cuando se usa y no queda vínculo, así que editarlo nunca altera una auditoría existente. Toma el
   * bloqueo de la plantilla: entre comprobar que el control es hoja y guardar, no puede cambiar el árbol.
   */
  @Transactional()
  async execute(templateId: string, controlId: string, levelId: string, input: SetSuggestedFindingT) {
    await lockTemplate(this.tx, templateId)
    const tree = new ControlTree(await loadControls(this.tx, templateId))
    if (!tree.has(controlId)) throw new DomainError(LibraryErrors.CONTROL_NOT_FOUND, { templateId, controlId })
    if (!tree.isLeaf(controlId)) throw new DomainError(LibraryErrors.SUGGESTED_FINDING_CONTROL_NOT_LEAF, { controlId })
    const level = await this.tx.scaleLevel.findUnique({ where: { id: levelId }, select: { id: true } })
    if (!level) throw new DomainError(LibraryErrors.SCALE_LEVEL_NOT_FOUND, { levelId })

    return this.tx.suggestedFinding.upsert({
      where: { controlId_levelId: { controlId, levelId } },
      create: { controlId, levelId, text: input.text },
      update: { text: input.text },
    })
  }
}
