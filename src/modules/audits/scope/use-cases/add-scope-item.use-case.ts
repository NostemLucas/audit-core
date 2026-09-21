import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { AuditEvents } from '../../domain/events.js'
import type { AddScopeItemT } from '../scope.schemas.js'
import { editableScope, listScope } from '../scope.queries.js'

@Injectable()
export class AddScopeItemUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
  ) {}

  /** Un nombre repetido en la misma auditoría lo rechaza la BD (UNIQUE) como AUDIT_SCOPE_ITEM_NAME_TAKEN. */
  @Transactional()
  async execute(actor: Actor, auditId: string, input: AddScopeItemT) {
    await editableScope(this.tx, actor, auditId)
    const item = await this.tx.auditScopeItem.create({ data: { auditId, name: input.name } })
    await this.events.publish(AuditEvents.ScopeItemAdded, { auditId, scopeItemId: item.id, name: item.name })
    return listScope(this.tx, auditId)
  }
}
