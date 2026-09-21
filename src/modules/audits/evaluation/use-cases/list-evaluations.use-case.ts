import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import type { ListEvaluationsQueryT } from '../evaluation.schemas.js'
import { findEvaluations, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class ListEvaluationsUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryReader,
  ) {}

  /** Todos los que ven la auditoría ven todos sus criterios (editar es solo del asignado, docs/06 §1). */
  async execute(actor: Actor, auditId: string, query: ListEvaluationsQueryT) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const rows = await findEvaluations(this.db, auditId, {
      ...(query.assignedTo && { assignedUserId: query.assignedTo }),
      ...(query.unassigned && { assignedUserId: null }),
      ...(query.status && { status: query.status }),
    })
    return toEvaluationViews(rows, await this.library.getTemplate(audit.templateId))
  }
}
