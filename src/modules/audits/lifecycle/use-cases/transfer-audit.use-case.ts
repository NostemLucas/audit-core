import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { UserDirectory } from '../../../identity/index.js'
import { type Actor, assertCanTransfer, isEligibleManager } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit, loadAuditView } from '../../infrastructure/audit.queries.js'
import { TeamFolderProvisioningService } from '../../infrastructure/team-folder-provisioning.service.js'
import { withAccess } from '../audit.presenter.js'
import type { TransferAuditT } from '../audit.schemas.js'

@Injectable()
export class TransferAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
    private readonly folders: TeamFolderProvisioningService,
  ) {}

  /**
   * La ÚNICA acción del ADMIN sobre una auditoría: pasarla a otro manager (p. ej. el anterior dejó la organización). En cualquier
   * estado. El nuevo manager debe poder dirigir auditorías (rol GERENTE). Queda en el historial con ambos nombres. Si ya es
   * el manager, no hace nada.
   */
  @Transactional()
  async execute(actor: Actor, id: string, input: TransferAuditT) {
    assertCanTransfer(actor)
    const audit = await loadAudit(this.tx, id)
    const next = await this.users.getOrFail(input.managerId)
    if (!isEligibleManager(next.roles)) throw new DomainError(AuditErrors.AUDIT_MANAGER_INELIGIBLE, { userId: next.id })

    if (audit.managerId !== next.id) {
      const previous = await this.users.getOrFail(audit.managerId)
      await this.tx.audit.update({ where: { id }, data: { managerId: next.id } })
      // El acceso persistente en Nextcloud (docs/07 §1.5) se mueve con el puesto de manager, igual que al armar equipo.
      await this.folders.revoke(audit.code, previous.username)
      await this.folders.grant(audit.code, next.username)
      await this.events.publish(AuditEvents.AuditTransferred, {
        auditId: id,
        fromName: previous.name,
        targetUserId: next.id,
        toName: next.name,
      })
    }
    const view = await loadAuditView(this.tx, id)
    return withAccess(view, actor, await accessOf(this.tx, actor, view))
  }
}
