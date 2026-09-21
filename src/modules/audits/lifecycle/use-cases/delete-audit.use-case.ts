import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { assertAuditEditable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'

@Injectable()
export class DeleteAuditUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Solo un borrador y solo su manager. Sus evaluaciones, alcance, equipo e historial caen en cascada. */
  @Transactional()
  async execute(actor: Actor, id: string): Promise<void> {
    const audit = await loadAudit(this.tx, id)
    assertOnAudit('manage', actor, await accessOf(this.tx, actor, audit))
    assertAuditEditable(audit.status)
    await this.tx.audit.delete({ where: { id } })
  }
}
