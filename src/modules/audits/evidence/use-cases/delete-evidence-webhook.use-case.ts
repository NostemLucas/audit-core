import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { LibraryReader } from '../../../library/index.js'
import { auditLifecycle } from '../../domain/audit.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import { evaluationLifecycle } from '../../domain/evaluation.lifecycle.js'
import type { NextcloudEvidenceDeletedWebhookT } from '../evidence.schemas.js'

@Injectable()
export class DeleteEvidenceWebhookUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * Nextcloud avisa que un archivo de evidencia se borró ALLÁ (docs/07 §1.3): Nextcloud es la fuente de verdad del
   * archivo, así que el borrado se refleja aquí sin pasar por el candado de edición (`EVIDENCE_LOCKED`) que sí aplica
   * al borrado disparado desde esta app — el archivo ya no está, sin importar en qué estado quedó el criterio.
   * Idempotente (igual que el registro): un archivo ya borrado, o uno que nunca se registró, no es error.
   *
   * `wasLocked` marca si esto pasó con el criterio bloqueado (aprobado) o la auditoría ya no evaluable — no lo
   * impide (el archivo ya se fue, no hay nada que "bloquear" acá), pero sí lo deja marcado en el evento: perder
   * evidencia de algo ya aprobado es un incidente, no un cambio de trabajo normal (docs/07 §1.3).
   */
  @Transactional()
  async execute(payload: NextcloudEvidenceDeletedWebhookT): Promise<void> {
    const evidence = await this.tx.evidence.findUnique({
      where: { storageFileId: payload.fileId },
      select: {
        id: true,
        deletedAt: true,
        fileName: true,
        evaluation: {
          select: {
            id: true,
            controlId: true,
            auditId: true,
            status: true,
            audit: { select: { templateId: true, status: true } },
          },
        },
      },
    })
    if (!evidence || evidence.deletedAt) return

    await this.tx.evidence.update({ where: { id: evidence.id }, data: { deletedAt: this.clock.now() } })
    const template = await this.library.getTemplate(evidence.evaluation.audit.templateId)
    const wasLocked =
      !evaluationLifecycle.has(evidence.evaluation.status, 'editable') ||
      !auditLifecycle.has(evidence.evaluation.audit.status, 'evaluable')
    await this.events.publish(AuditEvents.EvidenceDeleted, {
      auditId: evidence.evaluation.auditId,
      evaluationId: evidence.evaluation.id,
      controlTitle: template.tree.pathTo(evidence.evaluation.controlId).at(-1)!.title,
      fileName: evidence.fileName,
      wasLocked,
    })
  }
}
