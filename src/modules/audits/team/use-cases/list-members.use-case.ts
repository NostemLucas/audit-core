import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { listTeam } from '../team.queries.js'

@Injectable()
export class ListMembersUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Todos los que ven la auditoría ven el equipo. El líder primero. */
  async execute(actor: Actor, auditId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    return listTeam(this.db, auditId)
  }
}
