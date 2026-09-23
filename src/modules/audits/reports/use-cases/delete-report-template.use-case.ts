import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { loadReportTemplate } from '../report-template.queries.js'

@Injectable()
export class DeleteReportTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Vuelve a la plantilla de fábrica para ese (type, dimension): no hay "sin plantilla", siempre queda el default. */
  @Transactional()
  async execute(id: string): Promise<void> {
    await loadReportTemplate(this.tx, id)
    await this.tx.reportTemplate.delete({ where: { id } })
  }
}
