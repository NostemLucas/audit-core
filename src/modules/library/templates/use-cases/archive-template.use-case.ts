import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { templateLifecycle } from '../domain/template.lifecycle.js'
import { loadTemplate, lockTemplate, withActions } from '../template.queries.js'

@Injectable()
export class ArchiveTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Una archivada ya no se elige para auditorías nuevas; las que la usan siguen intactas. Es un estado final. */
  @Transactional()
  async execute(id: string) {
    await lockTemplate(this.tx, id)
    const template = await loadTemplate(this.tx, id)
    await this.tx.template.update({
      where: { id },
      data: { status: templateLifecycle.next(template.status, 'ARCHIVE') },
    })
    return withActions(await loadTemplate(this.tx, id))
  }
}
