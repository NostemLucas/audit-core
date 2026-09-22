import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { listReports } from '../reports.queries.js'

@Injectable()
export class ListReportsUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Los ven todos los que ven la auditoría, lo más reciente primero. */
  async execute(actor: Actor, auditId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    return listReports(this.db, auditId)
  }
}
