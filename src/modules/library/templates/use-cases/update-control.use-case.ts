import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { assertTemplateEditable } from '../domain/template.lifecycle.js'
import type { UpdateControlT } from '../control.schemas.js'
import { listControls, loadTemplate } from '../template.queries.js'

@Injectable()
export class UpdateControlUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Cambia el contenido (referencia, título, descripción), no el lugar en el árbol. Devuelve solo ese control. */
  @Transactional()
  async execute(templateId: string, controlId: string, input: UpdateControlT) {
    assertTemplateEditable((await loadTemplate(this.tx, templateId)).status)

    const { count } = await this.tx.control.updateMany({
      where: { id: controlId, templateId },
      data: {
        ...(input.reference !== undefined && { reference: input.reference }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
      },
    })
    if (count === 0) throw new DomainError(LibraryErrors.CONTROL_NOT_FOUND, { templateId, controlId })
    return (await listControls(this.tx, templateId)).find((control) => control.id === controlId)!
  }
}
