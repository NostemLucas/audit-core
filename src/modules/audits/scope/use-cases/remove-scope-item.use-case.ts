import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents } from '../../domain/events.js'
import { editableScope, listScope } from '../scope.queries.js'

@Injectable()
export class RemoveScopeItemUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
  ) {}

  @Transactional()
  async execute(actor: Actor, auditId: string, scopeItemId: string) {
    await editableScope(this.tx, actor, auditId)
    const item = await this.tx.auditScopeItem.findFirst({ where: { id: scopeItemId, auditId } })
    if (!item) throw new DomainError(AuditErrors.AUDIT_SCOPE_ITEM_NOT_FOUND, { auditId, scopeItemId })
    await this.tx.auditScopeItem.delete({ where: { id: scopeItemId } })
    await this.events.publish(AuditEvents.ScopeItemRemoved, { auditId, scopeItemId, name: item.name })
    return listScope(this.tx, auditId)
  }
}
