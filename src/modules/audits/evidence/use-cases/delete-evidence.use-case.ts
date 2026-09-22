import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertCanEvaluate } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import { loadEvaluation } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadEvidence } from '../evidence.queries.js'

@Injectable()
export class DeleteEvidenceUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * El auditor asignado retira una evidencia (soft-delete: nunca se borra la fila, docs/01 — sigue siendo trazable).
   * Misma ventana que editar el contenido; no se toca el archivo en Nextcloud (docs/07 §5).
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
    await loadEvidence(this.tx, evaluationId, evidenceId)
    await this.tx.evidence.update({ where: { id: evidenceId }, data: { deletedAt: this.clock.now() } })
  }
}
