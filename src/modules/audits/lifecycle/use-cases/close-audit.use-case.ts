import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { auditLifecycle } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAuditForUpdate, loadAuditView, teamUsernames } from '../../infrastructure/audit.queries.js'
import { TeamFolderProvisioningService } from '../../infrastructure/team-folder-provisioning.service.js'
import { withAccess } from '../audit.presenter.js'

@Injectable()
export class CloseAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly folders: TeamFolderProvisioningService,
  ) {}

  /**
   * Exige todos los criterios APROBADOS, incluidos los «no aplica» (pasan por el mismo flujo de revisión). Efecto:
   * `closedAt`, y los informes del equipo pasan a solo lectura en Nextcloud (docs/07 §1.5: ya no hay razón legítima
   * para seguir editando el consolidado final).
   *
   * `loadAuditForUpdate` bloquea la fila (`SELECT ... FOR UPDATE`) ANTES de contar pendientes: mientras esta
   * transacción no termine, ninguna transición de evaluación que dependa de `assertAuditEvaluable` (completar,
   * aprobar, devolver, reabrir) puede escribir, porque todas piden el MISMO candado antes de tocar su fila
   * (`audit.queries.ts`). Sin esto, contar y luego escribir (aunque fuera en una sola sentencia atómica) dejaba
   * pasar un `REOPEN` concurrente — confirmado con una prueba de concurrencia real antes de agregar el candado.
   */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const audit = await loadAuditForUpdate(this.tx, id)
    assertOnAudit('manage', actor, await accessOf(this.tx, actor, audit))
    auditLifecycle.next(audit.status, 'CLOSE')

    const pending = await this.tx.evaluation.count({ where: { auditId: id, status: { not: 'APPROVED' } } })
    if (pending > 0) throw new DomainError(AuditErrors.AUDIT_HAS_PENDING_EVALUATIONS, { pending })

    await this.tx.audit.update({ where: { id }, data: { status: 'CLOSED', closedAt: this.clock.now() } })
    await this.folders.lockReports(audit.code, await teamUsernames(this.tx, id))
    await this.events.publish(AuditEvents.AuditClosed, { auditId: id })
    return withAccess(await loadAuditView(this.tx, id), actor, await accessOf(this.tx, actor, audit))
  }
}
