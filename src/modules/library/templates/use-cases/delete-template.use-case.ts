import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { assertTemplateEditable } from '../domain/template.lifecycle.js'
import { loadTemplate } from '../template.queries.js'

@Injectable()
export class DeleteTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Solo un borrador se elimina (sus controles caen en cascada); una publicada se archiva. Un borrador no puede estar en
   * uso (auditar exige una publicada); si alguna auditoría la referenciara igualmente, la FK (Restrict) lo impide y sale
   * como TEMPLATE_IN_USE.
   */
  @Transactional()
  async execute(id: string): Promise<void> {
    assertTemplateEditable((await loadTemplate(this.tx, id)).status)
    await this.tx.template.delete({ where: { id } })
  }
}
