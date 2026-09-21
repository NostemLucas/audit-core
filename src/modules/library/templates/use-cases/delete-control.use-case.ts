import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'
import { assertTemplateEditable } from '../domain/template.lifecycle.js'
import { listControls, loadControls, loadTemplate, lockTemplate, writeOrder } from '../template.queries.js'

@Injectable()
export class DeleteControlUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Solo se elimina un control sin hijos (los subcontroles se eliminan primero). Devuelve la lista completa. */
  @Transactional()
  async execute(templateId: string, controlId: string) {
    await lockTemplate(this.tx, templateId)
    assertTemplateEditable((await loadTemplate(this.tx, templateId)).status)

    const rows = await loadControls(this.tx, templateId)
    const tree = new ControlTree(rows)
    const control = rows.find((row) => row.id === controlId)
    if (!control) throw new DomainError(LibraryErrors.CONTROL_NOT_FOUND, { templateId, controlId })
    if (!tree.isLeaf(controlId)) {
      throw new DomainError(LibraryErrors.CONTROL_HAS_CHILDREN, {
        controlId,
        children: tree.childrenOf(controlId).length,
      })
    }

    await this.tx.control.delete({ where: { id: controlId } })
    const remaining = tree
      .childrenOf(control.parentId)
      .map((n) => n.id)
      .filter((id) => id !== controlId)
    await writeOrder(this.tx, remaining, new Map(rows.map((row) => [row.id, row.position] as const)))
    return listControls(this.tx, templateId)
  }
}
