import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { assertTemplateEditable } from '../domain/template.lifecycle.js'
import type { UpdateTemplateT } from '../template.schemas.js'
import { loadTemplate, lockTemplate, withActions } from '../template.queries.js'

@Injectable()
export class RenameTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** El nombre identifica a la norma: solo se cambia mientras está en borrador. */
  @Transactional()
  async execute(id: string, input: UpdateTemplateT) {
    await lockTemplate(this.tx, id)
    assertTemplateEditable((await loadTemplate(this.tx, id)).status)
    await this.tx.template.update({ where: { id }, data: { name: input.name } })
    return withActions(await loadTemplate(this.tx, id))
  }
}
