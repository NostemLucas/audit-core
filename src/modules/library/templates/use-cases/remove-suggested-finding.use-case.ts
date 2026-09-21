import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { loadTemplate } from '../template.queries.js'

@Injectable()
export class RemoveSuggestedFindingUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Idempotente: quitar una sugerencia que no existe deja el mismo resultado (no hay sugerencia). */
  @Transactional()
  async execute(templateId: string, controlId: string, levelId: string): Promise<void> {
    await loadTemplate(this.tx, templateId)
    await this.tx.suggestedFinding.deleteMany({ where: { controlId, levelId, control: { templateId } } })
  }
}
