import { Injectable } from '@nestjs/common'
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
export class StartAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
  ) {}

  /**
   * Orden fijo (docs/03 §2.3 regla 4): primero el ciclo de vida, luego las precondiciones, cada una con su propio 422 (docs/06
   * §2): un líder, al menos un auditor, nivel esperado en todas las hojas (en CONFORMITY ya viene fijado al crear) y todos los
   * criterios asignados.
   */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const audit = await loadAudit(this.tx, id)
    assertOnAudit('manage', actor, await accessOf(this.tx, actor, audit))
    const to = auditLifecycle.next(audit.status, 'START')

    const [leads, members, missingLevel, unassigned] = await Promise.all([
      this.tx.auditMember.count({ where: { auditId: id, role: 'LEAD' } }),
      this.tx.auditMember.count({ where: { auditId: id, role: 'MEMBER' } }),
      this.tx.evaluation.count({ where: { auditId: id, expectedLevelId: null } }),
      // Los trasladados de la auditoría anterior ya nacen aprobados: no hay nadie a quien asignarlos.
      this.tx.evaluation.count({ where: { auditId: id, assignedUserId: null, carriedFromId: null } }),
    ])
    if (leads === 0) throw new DomainError(AuditErrors.AUDIT_HAS_NO_LEAD, { auditId: id })
    if (members === 0) throw new DomainError(AuditErrors.AUDIT_HAS_NO_MEMBERS, { auditId: id })
    if (missingLevel > 0) throw new DomainError(AuditErrors.AUDIT_EXPECTED_LEVELS_MISSING, { missing: missingLevel })
    if (unassigned > 0) throw new DomainError(AuditErrors.AUDIT_UNASSIGNED_EVALUATIONS, { missing: unassigned })

    await this.tx.audit.update({ where: { id }, data: { status: to } })
    await this.events.publish(AuditEvents.AuditStarted, { auditId: id })
    return withAccess(await loadAuditView(this.tx, id), actor, await accessOf(this.tx, actor, audit))
  }
}
