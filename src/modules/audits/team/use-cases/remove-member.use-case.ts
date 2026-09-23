import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { UserDirectory } from '../../../identity/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { assignedCount, listTeam, loadMember, manageableTeam } from '../team.queries.js'
import { TeamFolderProvisioningService } from '../team-folder-provisioning.service.js'

@Injectable()
export class RemoveMemberUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
    private readonly folders: TeamFolderProvisioningService,
  ) {}

  /**
   * Quien tiene criterios asignados no se quita: el líder los reasigna antes (nadie se queda con trabajo sin dueño).
   * También le revoca el acceso persistente en Nextcloud (docs/07 §1.5) — deja de ver evidencia e informes.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, memberId: string) {
    const audit = await manageableTeam(this.tx, actor, auditId)
    const member = await loadMember(this.tx, auditId, memberId)
    const count = await assignedCount(this.tx, auditId, member.userId)
    if (count > 0) throw new DomainError(AuditErrors.MEMBER_HAS_ASSIGNED_EVALUATIONS, { memberId, count })

    const user = await this.users.getOrFail(member.userId)
    await this.tx.auditMember.delete({ where: { id: memberId } })
    await this.folders.revoke(audit.code, user.username)
    await this.events.publish(AuditEvents.MemberRemoved, {
      auditId,
      memberId,
      targetUserId: user.id,
      userName: user.name,
      role: member.role,
    })
    return listTeam(this.tx, auditId)
  }
}
