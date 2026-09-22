import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { evidenceFolder, FILE_STORAGE, type FileStoragePort } from '../../../../platform/nextcloud/index.js'
import { assertAuditEvaluable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertCanEvaluate } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadEvaluation } from '../../evaluation/evaluation.queries.js'

@Injectable()
export class RequestEvidenceUploadUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /**
   * El auditor asignado pide un lugar donde subir evidencia (docs/07 §1.1): el backend nunca ve el archivo, solo
   * habilita la carpeta y comparte un enlace de solo-subida sobre ella. Misma ventana que editar el contenido.
   */
  async execute(actor: Actor, auditId: string, evaluationId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertAuditEvaluable(audit.status)
    const evaluation = await loadEvaluation(this.db, auditId, evaluationId)
    assertCanEvaluate(actor, await accessOf(this.db, actor, audit), evaluation.assignedUserId)
    if (!evaluationLifecycle.has(evaluation.status, 'editable')) {
      throw new DomainError(AuditErrors.EVIDENCE_LOCKED, { evaluationId, status: evaluation.status })
    }
    return this.storage.createUploadTarget(evidenceFolder(audit.code, evaluationId))
  }
}
