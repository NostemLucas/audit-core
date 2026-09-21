import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LIMITS } from '../../../../shared/limits.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'
import { assertTemplateEditable } from '../domain/template.lifecycle.js'
import type { CreateControlT } from '../control.schemas.js'
import { listControls, loadControls, loadTemplate, lockTemplate, placeInParent } from '../template.queries.js'

@Injectable()
export class CreateControlUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Devuelve la lista completa: las posiciones de los hermanos pueden haber cambiado. */
  @Transactional()
  async execute(templateId: string, input: CreateControlT) {
    await lockTemplate(this.tx, templateId)
    assertTemplateEditable((await loadTemplate(this.tx, templateId)).status)

    const rows = await loadControls(this.tx, templateId)
    const tree = new ControlTree(rows)
    const parentId = input.parentId ?? null
    if (parentId !== null && !tree.has(parentId)) {
      throw new DomainError(LibraryErrors.CONTROL_PARENT_INVALID, { parentId, reason: 'NOT_IN_TEMPLATE' })
    }
    const depth = parentId === null ? 0 : tree.depthOf(parentId) + 1
    if (depth >= LIMITS.controlDepth)
      throw new DomainError(LibraryErrors.CONTROL_DEPTH_EXCEEDED, { max: LIMITS.controlDepth })

    const end = tree.childrenOf(parentId).length
    const created = await this.tx.control.create({
      data: {
        templateId,
        parentId,
        reference: input.reference ?? null,
        title: input.title,
        description: input.description ?? null,
        position: end,
      },
    })
    if (input.position !== undefined && input.position < end) {
      const positions = new Map([...rows.map((r) => [r.id, r.position] as const), [created.id, end]])
      await placeInParent(this.tx, tree, parentId, created.id, input.position, positions)
    }
    return listControls(this.tx, templateId)
  }
}
