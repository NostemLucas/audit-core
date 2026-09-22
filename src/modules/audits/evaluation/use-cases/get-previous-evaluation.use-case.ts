import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { EVALUATION_INCLUDE, loadEvaluation, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class GetPreviousEvaluationUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryReader,
  ) {}

  /**
   * Cómo quedó ESTE mismo control en la auditoría anterior (por `previousAuditId` + `controlId`, no por
   * `carriedFromId`: así funciona igual para lo trasladado y para lo que se re-evalúa desde cero). `null` si esta
   * auditoría no es un seguimiento, o si el control es nuevo y no existía en la anterior. El acceso se valida contra
   * ESTA auditoría (la que el actor ya puede ver), igual que `previousAudit` en `AuditView` — no hace falta que
   * también pueda ver la anterior.
   */
  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const current = await loadEvaluation(this.db, auditId, evaluationId)
    if (!audit.previousAuditId) return null

    const previousRow = await this.db.evaluation.findFirst({
      where: { auditId: audit.previousAuditId, controlId: current.controlId },
      include: EVALUATION_INCLUDE,
    })
    if (!previousRow) return null

    const template = await this.library.getTemplate(audit.templateId)
    return toEvaluationViews([previousRow], template)[0]!
  }
}
