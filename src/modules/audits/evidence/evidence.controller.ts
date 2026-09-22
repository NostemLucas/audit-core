import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { EvaluationId } from '../evaluation/evaluation.schemas.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import { EvidenceId, EvidenceView, UploadTargetView } from './evidence.schemas.js'
import { DeleteEvidenceUseCase } from './use-cases/delete-evidence.use-case.js'
import { ListEvidenceUseCase } from './use-cases/list-evidence.use-case.js'
import { RequestEvidenceUploadUseCase } from './use-cases/request-evidence-upload.use-case.js'

/** Evidencia de un criterio (docs/07 §1): el backend nunca ve el archivo, solo su metadato. */
@Controller('audits/:auditId/evaluations/:evaluationId/evidence')
export class EvidenceController {
  constructor(
    private readonly listUseCase: ListEvidenceUseCase,
    private readonly requestUploadUseCase: RequestEvidenceUploadUseCase,
    private readonly deleteUseCase: DeleteEvidenceUseCase,
  ) {}

  @Get()
  @Can('read', 'Evidence')
  @Responds(EvidenceView, { kind: 'list' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
  ) {
    return this.listUseCase.execute(actor, auditId, evaluationId)
  }

  /** El auditor asignado pide dónde subir; sube directo a Nextcloud con la URL devuelta. */
  @Post('upload-target')
  @HttpCode(201)
  @Can('create', 'Evidence')
  @Responds(UploadTargetView, { status: 201 })
  requestUpload(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
  ) {
    return this.requestUploadUseCase.execute(actor, auditId, evaluationId)
  }

  @Delete(':evidenceId')
  @HttpCode(204)
  @Can('delete', 'Evidence')
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
    @Param('evidenceId', { schema: EvidenceId }) evidenceId: string,
  ): Promise<void> {
    await this.deleteUseCase.execute(actor, auditId, evaluationId, evidenceId)
  }
}
