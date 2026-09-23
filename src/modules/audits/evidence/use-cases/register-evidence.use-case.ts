import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { evaluationIdFromEvidencePath } from '../../../../platform/nextcloud/index.js'
import { LibraryReader } from '../../../library/index.js'
import { AuditErrors } from '../../domain/errors.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import type { NextcloudEvidenceWebhookT } from '../evidence.schemas.js'

@Injectable()
export class RegisterEvidenceUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El webhook de Nextcloud (ya verificado por su firma, docs/07 §1.2): registra el metadato de un archivo que el
   * cliente subió directo. El `evaluationId` sale del propio `path`; Nextcloud no necesita conocer nuestros ids de
   * ningún otro modo. `createdById` = el auditor asignado (quien pidió el lugar de subida): el webhook no trae quién
   * subió, así que se infiere de la asignación — quien tenga la URL del share puede subir (la superficie de un share).
   */
  @Transactional()
  async execute(payload: NextcloudEvidenceWebhookT) {
    const evaluationId = evaluationIdFromEvidencePath(payload.path)
    if (!evaluationId) throw new DomainError(AuditErrors.EVIDENCE_PATH_INVALID, { path: payload.path })

    const evaluation = await this.tx.evaluation.findUnique({
      where: { id: evaluationId },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        controlId: true,
        audit: { select: { id: true, templateId: true } },
      },
    })
    if (!evaluation) throw new DomainError(AuditErrors.EVALUATION_NOT_FOUND, { evaluationId })
    if (!evaluationLifecycle.has(evaluation.status, 'editable')) {
      throw new DomainError(AuditErrors.EVIDENCE_LOCKED, { evaluationId, status: evaluation.status })
    }

    const created = await this.tx.evidence.create({
      data: {
        evaluationId,
        title: payload.fileName.replace(/\.[^./]+$/, '') || payload.fileName,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        size: BigInt(payload.size),
        storageFileId: payload.fileId,
        createdById: evaluation.assignedUserId,
      },
    })
    const template = await this.library.getTemplate(evaluation.audit.templateId)
    await this.events.publish(AuditEvents.EvidenceRegistered, {
      auditId: evaluation.audit.id,
      evaluationId,
      controlTitle: template.tree.pathTo(evaluation.controlId).at(-1)!.title,
      fileName: payload.fileName,
    })
    return created
  }
}
