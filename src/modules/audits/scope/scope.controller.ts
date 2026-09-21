import { Body, Controller, Delete, Param, Post } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import { AddScopeItem, type AddScopeItemT, ScopeItemId, ScopeItemView } from './scope.schemas.js'
import { AddScopeItemUseCase } from './use-cases/add-scope-item.use-case.js'
import { RemoveScopeItemUseCase } from './use-cases/remove-scope-item.use-case.js'

/** El alcance de una auditoría (qué se audita). Devuelve la lista completa tras cada cambio. */
@Controller('audits/:auditId/scope-items')
export class ScopeController {
  constructor(
    private readonly add: AddScopeItemUseCase,
    private readonly remove: RemoveScopeItemUseCase,
  ) {}

  @Post()
  @Can('update', 'Audit')
  @Responds(ScopeItemView, { kind: 'list', status: 201 })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Body({ schema: AddScopeItem }) body: AddScopeItemT,
  ) {
    return this.add.execute(actor, auditId, body)
  }

  @Delete(':itemId')
  @Can('update', 'Audit')
  @Responds(ScopeItemView, { kind: 'list' })
  delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('itemId', { schema: ScopeItemId }) itemId: string,
  ) {
    return this.remove.execute(actor, auditId, itemId)
  }
}
