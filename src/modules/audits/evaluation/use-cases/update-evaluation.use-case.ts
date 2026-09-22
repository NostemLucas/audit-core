import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx, versionConflict } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertCanEvaluate } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import type { UpdateEvaluationContentT } from '../evaluation.schemas.js'
import { loadEvaluation, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class UpdateEvaluationUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El auditor asignado edita el contenido: nivel alcanzado, hallazgos, notas, o lo marca "no aplica". El primer envío
   * arranca el criterio (`NOT_STARTED` → `IN_PROGRESS`, con su propio evento); después solo se edita en `IN_PROGRESS` y
   * `RETURNED` (`EVALUATION_NOT_EDITABLE`). No cambia de estado por sí sola: enviar a revisión es una acción aparte.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, input: UpdateEvaluationContentT) {
    const audit = await loadAudit(this.tx, auditId)
    assertAuditEvaluable(audit.status)
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)
    assertCanEvaluate(actor, await accessOf(this.tx, actor, audit), evaluation.assignedUserId)

    const starting = evaluationLifecycle.can(evaluation.status, 'START')
    if (!starting && !evaluationLifecycle.has(evaluation.status, 'editable')) {
      throw new DomainError(AuditErrors.EVALUATION_NOT_EDITABLE, { evaluationId, status: evaluation.status })
    }

    if (input.achievedLevelId) {
      // "No aplica" y nivel alcanzado son excluyentes: hay que desmarcar antes "no aplica" de forma explícita.
      if (evaluation.isNotApplicable && input.isNotApplicable !== false) {
        throw new DomainError(AuditErrors.EVALUATION_IS_NOT_APPLICABLE, { evaluationId })
      }
      const scale = await this.library.getScale(audit.scaleId)
      if (!scale.levels.some((level) => level.id === input.achievedLevelId)) {
        throw new DomainError(AuditErrors.EVALUATION_LEVEL_NOT_IN_SCALE, { levelId: input.achievedLevelId })
      }
    }
    if (input.isNotApplicable === true) {
      const reason = input.notApplicableReason ?? evaluation.notApplicableReason
      if (!reason) throw new DomainError(AuditErrors.NOT_APPLICABLE_REASON_REQUIRED, { evaluationId })
    }

    // UNA sola escritura (arrancar el criterio + el contenido), con la versión que el cliente leyó (docs/06 §10).
    const { count } = await this.tx.evaluation.updateMany({
      where: { id: evaluationId, version: input.version },
      data: {
        ...(starting && { status: evaluationLifecycle.next(evaluation.status, 'START') }),
        ...(input.achievedLevelId !== undefined && { achievedLevelId: input.achievedLevelId }),
        ...(input.findings !== undefined && { findings: input.findings }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.severity !== undefined && { severity: input.severity }),
        ...(input.isNotApplicable === true && { isNotApplicable: true, achievedLevelId: null, severity: null }),
        ...(input.isNotApplicable === false && { isNotApplicable: false, notApplicableReason: null }),
        ...(input.notApplicableReason !== undefined &&
          input.isNotApplicable !== false && { notApplicableReason: input.notApplicableReason }),
      },
    })
    if (count === 0) throw versionConflict('Evaluation', evaluationId, input.version)
    if (starting) {
      await this.events.publish(AuditEvents.EvaluationStarted, {
        auditId,
        evaluationId,
        controlTitle: await this.controlTitle(audit.templateId, evaluation.controlId),
      })
    }

    const template = await this.library.getTemplate(audit.templateId)
    return toEvaluationViews([await loadEvaluation(this.tx, auditId, evaluationId)], template)[0]!
  }

  private async controlTitle(templateId: string, controlId: string): Promise<string> {
    const template = await this.library.getTemplate(templateId)
    return template.tree.pathTo(controlId).at(-1)!.title
  }
}
