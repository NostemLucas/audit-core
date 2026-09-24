import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import {
  AddMember,
  type AddMemberT,
  ChangeMemberRole,
  type ChangeMemberRoleT,
  MemberId,
  MemberView,
} from './team.schemas.js'
import { AddMemberUseCase } from './use-cases/add-member.use-case.js'
import { ChangeMemberRoleUseCase } from './use-cases/change-member-role.use-case.js'
import { ListMembersUseCase } from './use-cases/list-members.use-case.js'
import { RemoveMemberUseCase } from './use-cases/remove-member.use-case.js'

/** El equipo de la auditoría. Lo arma el MANAGER; todos los miembros lo ven. Devuelve el equipo completo tras cada cambio. (Tier B, docs/02 §4) */
@Controller('audits/:auditId/members')
export class TeamController {
  constructor(
    private readonly list: ListMembersUseCase,
    private readonly add: AddMemberUseCase,
    private readonly change: ChangeMemberRoleUseCase,
    private readonly remove: RemoveMemberUseCase,
  ) {}

  @Get()
  @Can('read', 'AuditMember')
  @Responds(MemberView, { kind: 'list' })
  findAll(@CurrentUser() actor: AuthenticatedUser, @Param('auditId', { schema: AuditId }) auditId: string) {
    return this.list.execute(actor, auditId)
  }

  @Post()
  @Can('create', 'AuditMember')
  @Responds(MemberView, { kind: 'list', status: 201 })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Body({ schema: AddMember }) body: AddMemberT,
  ) {
    return this.add.execute(actor, auditId, body)
  }

  @Patch(':memberId')
  @Can('update', 'AuditMember')
  @Responds(MemberView, { kind: 'list' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('memberId', { schema: MemberId }) memberId: string,
    @Body({ schema: ChangeMemberRole }) body: ChangeMemberRoleT,
  ) {
    return this.change.execute(actor, auditId, memberId, body)
  }

  @Delete(':memberId')
  @Can('delete', 'AuditMember')
  @Responds(MemberView, { kind: 'list' })
  delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('memberId', { schema: MemberId }) memberId: string,
  ) {
    return this.remove.execute(actor, auditId, memberId)
  }
}
