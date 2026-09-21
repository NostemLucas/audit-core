import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertCanEvaluate } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import { missingForCompletion } from '../../domain/evaluation-completion.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadEvaluation, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class CompleteEvaluationUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /** El auditor asignado envía el criterio a revisión. Guarda una copia del contenido en el evento (docs/06 §4). */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const audit = await loadAudit(this.tx, auditId)
    assertAuditEvaluable(audit.status)
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)
    assertCanEvaluate(actor, await accessOf(this.tx, actor, audit), evaluation.assignedUserId)
    const to = evaluationLifecycle.next(evaluation.status, 'COMPLETE')

    const scale = await this.library.getScale(audit.scaleId)
    const byId = new Map(scale.levels.map((level) => [level.id, level] as const))
    const missing = missingForCompletion(
      evaluation,
      {
        expected: evaluation.expectedLevelId ? byId.get(evaluation.expectedLevelId)! : { value: 0 },
        achieved: evaluation.achievedLevelId ? (byId.get(evaluation.achievedLevelId) ?? null) : null,
        minimum: scale.levels[0]!,
      },
      evaluation._count.evidences,
    )
    if (missing.length > 0) throw new DomainError(AuditErrors.EVALUATION_INCOMPLETE, { missing })

    await this.tx.evaluation.update({ where: { id: evaluationId }, data: { status: to } })

    const template = await this.library.getTemplate(audit.templateId)
    const evidence = await this.tx.evidence.findMany({
      where: { evaluationId, deletedAt: null },
      select: { id: true, title: true },
    })
    await this.events.publish(AuditEvents.EvaluationCompleted, {
      auditId,
      evaluationId,
      controlTitle: template.tree.pathTo(evaluation.controlId).at(-1)!.title,
      achievedLevelLabel: evaluation.achievedLevel?.label ?? null,
      isNotApplicable: evaluation.isNotApplicable,
      notApplicableReason: evaluation.notApplicableReason,
      findings: evaluation.findings,
      notes: evaluation.notes,
      evidence,
    })
    return toEvaluationViews([await loadEvaluation(this.tx, auditId, evaluationId)], template)[0]!
  }
}
