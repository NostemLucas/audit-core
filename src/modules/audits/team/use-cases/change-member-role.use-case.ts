import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { UserDirectory } from '../../../identity/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import type { ChangeMemberRoleT } from '../team.schemas.js'
import { assignedCount, listTeam, loadMember, manageableTeam } from '../team.queries.js'

@Injectable()
export class ChangeMemberRoleUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
  ) {}

  /**
   * Cambia el rol de un miembro (así se cambia de líder: primero el actual pasa a auditor, luego el nuevo a líder). Quien tiene
   * criterios asignados no puede ser líder: el líder revisa, no evalúa. Un segundo líder lo rechaza la BD.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, memberId: string, input: ChangeMemberRoleT) {
    await manageableTeam(this.tx, actor, auditId)
    const member = await loadMember(this.tx, auditId, memberId)
    if (member.role === input.role) return listTeam(this.tx, auditId)

    if (input.role === 'LEAD') {
      const count = await assignedCount(this.tx, auditId, member.userId)
      if (count > 0) throw new DomainError(AuditErrors.MEMBER_HAS_ASSIGNED_EVALUATIONS, { memberId, count })
    }
    await this.tx.auditMember.update({ where: { id: memberId }, data: { role: input.role } })
    const user = await this.users.getOrFail(member.userId)
    await this.events.publish(AuditEvents.MemberRoleChanged, {
      auditId,
      memberId,
      targetUserId: user.id,
      userName: user.name,
      from: member.role,
      to: input.role,
    })
    return listTeam(this.tx, auditId)
  }
}
