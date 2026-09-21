import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAuditView } from '../../infrastructure/audit.queries.js'
import { withAccess } from '../audit.presenter.js'

@Injectable()
export class GetAuditUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(actor: Actor, id: string) {
    const audit = await loadAuditView(this.db, id)
    const access = await accessOf(this.db, actor, audit)
    assertOnAudit('read', actor, access)
    return withAccess(audit, actor, access)
  }
}
