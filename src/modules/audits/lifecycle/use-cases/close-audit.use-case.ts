import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { auditLifecycle } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit, loadAuditView, teamUsernames } from '../../infrastructure/audit.queries.js'
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
   * Contar los pendientes y luego escribir en dos pasos dejaba una ventana: un REOPEN concurrente sobre un criterio
   * ya aprobado podía colarse entre el conteo y el `UPDATE`. El `UPDATE` de abajo lo reduce a UNA sola sentencia
   * (`NOT EXISTS` en el `WHERE`) — pero esto NO es una garantía completa: verificado con una prueba de concurrencia
   * real, sigue siendo posible que un `REOPEN` (que escribe en `evaluations`, otra tabla) y este `UPDATE` (que lee
   * `evaluations` sin bloquearla) pasen los dos, porque no comparten ningún bloqueo. Cerrar esa ventana del todo
   * pediría que TODA transición de evaluación tome un `SELECT ... FOR UPDATE` sobre la fila de `audits` antes de
   * escribir — bloqueos de fila explícitos, que este proyecto evita a propósito en todos lados
   * (`platform/db/version-conflict.ts`) — o aislamiento `SERIALIZABLE` con reintento. Es una decisión de arquitectura
   * más grande que este caso de uso, pendiente de tomarse a propósito; mientras tanto esto reduce la ventana real
   * (antes, dos consultas separadas con tiempo de sobra entre medias) sin cerrarla del todo.
   */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const audit = await loadAudit(this.tx, id)
    assertOnAudit('manage', actor, await accessOf(this.tx, actor, audit))
    auditLifecycle.next(audit.status, 'CLOSE') // valida temprano, con el estado que se acaba de leer

    const affected = await this.tx.$executeRaw`
      UPDATE audits
      SET status = 'CLOSED', "closedAt" = ${this.clock.now()}
      WHERE id = ${id} AND status = 'IN_PROGRESS'
        AND NOT EXISTS (SELECT 1 FROM evaluations WHERE "auditId" = ${id} AND status <> 'APPROVED')
    `
    if (affected === 0) {
      const fresh = await loadAudit(this.tx, id)
      auditLifecycle.next(fresh.status, 'CLOSE') // si ya no es IN_PROGRESS, lanza con el estado real
      const pending = await this.tx.evaluation.count({ where: { auditId: id, status: { not: 'APPROVED' } } })
      if (pending > 0) throw new DomainError(AuditErrors.AUDIT_HAS_PENDING_EVALUATIONS, { pending })
      throw new DomainError(AuditErrors.AUDIT_INVALID_STATE, { entity: 'AUDIT', from: fresh.status, event: 'CLOSE' })
    }

    await this.folders.lockReports(audit.code, await teamUsernames(this.tx, id))
    await this.events.publish(AuditEvents.AuditClosed, { auditId: id })
    return withAccess(await loadAuditView(this.tx, id), actor, await accessOf(this.tx, actor, audit))
  }
}
