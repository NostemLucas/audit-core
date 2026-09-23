import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { listReportTemplates } from '../report-template.queries.js'

@Injectable()
export class ListReportTemplatesUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  execute() {
    return listReportTemplates(this.db)
  }
}
