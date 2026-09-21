import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { UserDirectory } from '../../../identity/index.js'
import { isEligibleForTeam } from '../../domain/audit-policy.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import type { AddMemberT } from '../team.schemas.js'
import { listTeam, manageableTeam } from '../team.queries.js'

@Injectable()
export class AddMemberUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
  ) {}

  /**
   * El manager agrega a alguien al equipo como líder o auditor. Debe tener el rol global AUDITOR o GERENTE. Que ya sea miembro
   * (MEMBER_ALREADY_ASSIGNED) o que ya haya líder (AUDIT_LEAD_ALREADY_ASSIGNED) lo rechaza la BD con sus índices únicos, sin
   * bloqueos: dos altas simultáneas no pueden dejar dos líderes.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, input: AddMemberT) {
    await manageableTeam(this.tx, actor, auditId)
    const user = await this.users.getOrFail(input.userId)
    if (!isEligibleForTeam(user.roles)) throw new DomainError(AuditErrors.MEMBER_USER_INELIGIBLE, { userId: user.id })

    const member = await this.tx.auditMember.create({ data: { auditId, userId: user.id, role: input.role } })
    await this.events.publish(AuditEvents.MemberAssigned, {
      auditId,
      memberId: member.id,
      targetUserId: user.id,
      userName: user.name,
      role: member.role,
    })
    return listTeam(this.tx, auditId)
  }
}
