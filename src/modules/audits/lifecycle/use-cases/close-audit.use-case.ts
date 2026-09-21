import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { auditLifecycle } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit, loadAuditView } from '../../infrastructure/audit.queries.js'
import { withAccess } from '../audit.presenter.js'

@Injectable()
export class CloseAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  /** Exige todos los criterios APROBADOS, incluidos los «no aplica» (pasan por el mismo flujo de revisión). Efecto: `closedAt`. */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const audit = await loadAudit(this.tx, id)
    assertOnAudit('manage', actor, await accessOf(this.tx, actor, audit))
    const to = auditLifecycle.next(audit.status, 'CLOSE')

    const pending = await this.tx.evaluation.count({ where: { auditId: id, status: { not: 'APPROVED' } } })
    if (pending > 0) throw new DomainError(AuditErrors.AUDIT_HAS_PENDING_EVALUATIONS, { pending })

    await this.tx.audit.update({ where: { id }, data: { status: to, closedAt: this.clock.now() } })
    await this.events.publish(AuditEvents.AuditClosed, { auditId: id })
    return withAccess(await loadAuditView(this.tx, id), actor, await accessOf(this.tx, actor, audit))
  }
}
