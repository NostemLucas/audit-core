import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { loadReportTemplate } from '../report-template.queries.js'

@Injectable()
export class GetReportTemplateUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Los bytes del .docx tal como se subió, para descargarlo, editarlo y volverlo a subir. */
  async execute(id: string): Promise<{ content: Buffer; type: string }> {
    const row = await loadReportTemplate(this.db, id)
    return { content: Buffer.from(row.content), type: row.type }
  }
}
