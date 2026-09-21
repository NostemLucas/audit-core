import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LIMITS } from '../../../../shared/limits.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'
import { assertTemplateEditable } from '../domain/template.lifecycle.js'
import type { MoveControlT } from '../control.schemas.js'
import {
  listControls,
  loadControls,
  loadTemplate,
  lockTemplate,
  placeInParent,
  writeOrder,
} from '../template.queries.js'

@Injectable()
export class MoveControlUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Cambiar de padre y/o de lugar entre hermanos (subir y bajar es moverlo a otra posición). Devuelve la lista completa. */
  @Transactional()
  async execute(templateId: string, controlId: string, input: MoveControlT) {
    await lockTemplate(this.tx, templateId)
    assertTemplateEditable((await loadTemplate(this.tx, templateId)).status)

    const rows = await loadControls(this.tx, templateId)
    const tree = new ControlTree(rows)
    const moving = rows.find((row) => row.id === controlId)
    if (!moving) throw new DomainError(LibraryErrors.CONTROL_NOT_FOUND, { templateId, controlId })

    const { parentId } = input
    if (parentId !== null && !tree.has(parentId)) {
      throw new DomainError(LibraryErrors.CONTROL_PARENT_INVALID, { parentId, reason: 'NOT_IN_TEMPLATE' })
    }
    if (tree.wouldCreateCycle(controlId, parentId)) {
      throw new DomainError(LibraryErrors.CONTROL_PARENT_INVALID, { parentId, reason: 'CYCLE' })
    }
    if (tree.depthAfterMove(controlId, parentId) >= LIMITS.controlDepth) {
      throw new DomainError(LibraryErrors.CONTROL_DEPTH_EXCEEDED, { max: LIMITS.controlDepth })
    }

    const positions = new Map(rows.map((row) => [row.id, row.position] as const))
    if (parentId !== moving.parentId) {
      await this.tx.control.update({ where: { id: controlId }, data: { parentId } })
      // El grupo que deja: sin el nodo y sin huecos.
      const left = tree
        .childrenOf(moving.parentId)
        .map((n) => n.id)
        .filter((id) => id !== controlId)
      await writeOrder(this.tx, left, positions)
    }
    await placeInParent(this.tx, tree, parentId, controlId, input.position, positions)
    return listControls(this.tx, templateId)
  }
}
