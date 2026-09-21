import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { auditLifecycle } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit, loadAuditView } from '../../infrastructure/audit.queries.js'
import { withAccess } from '../audit.presenter.js'

@Injectable()
export class ArchiveAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
  ) {}

  /** Sin precondiciones además del ciclo de vida: es un estado final. */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const audit = await loadAudit(this.tx, id)
    assertOnAudit('manage', actor, await accessOf(this.tx, actor, audit))
    const to = auditLifecycle.next(audit.status, 'ARCHIVE')

    await this.tx.audit.update({ where: { id }, data: { status: to } })
    await this.events.publish(AuditEvents.AuditArchived, { auditId: id })
    return withAccess(await loadAuditView(this.tx, id), actor, await accessOf(this.tx, actor, audit))
  }
}
