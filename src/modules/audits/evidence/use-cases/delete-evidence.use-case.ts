import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertCanEvaluate } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import { loadEvaluation } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadEvidence } from '../evidence.queries.js'

@Injectable()
export class DeleteEvidenceUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El auditor asignado retira una evidencia (soft-delete: nunca se borra la fila, docs/01 — sigue siendo trazable).
   * Misma ventana que editar el contenido; no se toca el archivo en Nextcloud (docs/07 §5) — pero si alguien lo borra
   * ALLÁ, `DeleteEvidenceWebhookUseCase` refleja lo mismo aquí, con el mismo evento (docs/07 §1.3).
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, evaluationId: string, evidenceId: string): Promise<void> {
    const audit = await loadAudit(this.tx, auditId)
    assertAuditEvaluable(audit.status)
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)
    assertCanEvaluate(actor, await accessOf(this.tx, actor, audit), evaluation.assignedUserId)
    if (!evaluationLifecycle.has(evaluation.status, 'editable')) {
      throw new DomainError(AuditErrors.EVIDENCE_LOCKED, { evaluationId, status: evaluation.status })
    }
    const evidence = await loadEvidence(this.tx, evaluationId, evidenceId)
    await this.tx.evidence.update({ where: { id: evidenceId }, data: { deletedAt: this.clock.now() } })

    const template = await this.library.getTemplate(audit.templateId)
    await this.events.publish(AuditEvents.EvidenceDeleted, {
      auditId,
      evaluationId,
      controlTitle: template.tree.pathTo(evaluation.controlId).at(-1)!.title,
      fileName: evidence.fileName,
    })
  }
}
