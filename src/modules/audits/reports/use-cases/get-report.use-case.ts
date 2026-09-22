import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { FILE_STORAGE, type FileStoragePort, reportPath } from '../../../../platform/nextcloud/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadReport } from '../reports.queries.js'

@Injectable()
export class GetReportUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /** El informe con un enlace de descarga fresco (un share de solo lectura pedido al vuelo, docs/07 §2). */
  async execute(actor: Actor, auditId: string, reportId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const report = await loadReport(this.db, auditId, reportId)
    const share = await this.storage.createReadShare(reportPath(audit.code, report.id))
    return { ...report, downloadUrl: share.url }
  }
}
