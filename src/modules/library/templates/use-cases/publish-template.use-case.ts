import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'
import { templateLifecycle } from '../domain/template.lifecycle.js'
import { loadControls, loadTemplate, lockTemplate, withActions } from '../template.queries.js'

@Injectable()
export class PublishTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Orden fijo (docs/03 §2.3, regla 4): primero el ciclo de vida, para que un estado inválido gane a cualquier otro error;
   * luego las precondiciones (cada una con su propio 422 que explica el motivo); al final el cambio de estado.
   */
  @Transactional()
  async execute(id: string) {
    await lockTemplate(this.tx, id)
    const template = await loadTemplate(this.tx, id)
    const to = templateLifecycle.next(template.status, 'PUBLISH')

    const controls = await loadControls(this.tx, id)
    if (controls.length === 0) throw new DomainError(LibraryErrors.TEMPLATE_EMPTY, { id })
    const childless = new ControlTree(controls).childlessRoots()
    if (childless.length > 0) {
      throw new DomainError(LibraryErrors.TEMPLATE_INVALID_STRUCTURE, {
        roots: childless.map(({ id: controlId, title }) => ({ id: controlId, title })),
      })
    }

    await this.tx.template.update({ where: { id }, data: { status: to } })
    return withActions(await loadTemplate(this.tx, id))
  }
}
