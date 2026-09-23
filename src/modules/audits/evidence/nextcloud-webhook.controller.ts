import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { Public } from '../../../platform/authz/index.js'
import { ENV, type Env } from '../../../platform/config/index.js'
import { DB, type Db } from '../../../platform/db/index.js'
import { DomainError, PlatformErrors } from '../../../platform/errors/index.js'
import { Responds } from '../../../platform/http/index.js'
import { verifyWebhookSignature } from '../../../platform/nextcloud/index.js'
import { AuditErrors } from '../domain/errors.js'
import { findEvidenceByStorageFileId } from './evidence.queries.js'
import { EvidenceView, NextcloudEvidenceWebhook } from './evidence.schemas.js'
import { RegisterEvidenceUseCase } from './use-cases/register-evidence.use-case.js'

/**
 * Nextcloud avisa aquí cuando llega un archivo de evidencia (docs/07 §1.2). No hay JWT de Authentik: se autentica con
 * la firma HMAC, sobre el CUERPO CRUDO (`rawBody`, activado en `main.ts`/`app.ts` — un espacio de más cambia la firma).
 */
@Public()
@Controller('webhooks/nextcloud')
export class NextcloudWebhookController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly registerUseCase: RegisterEvidenceUseCase,
  ) {}

  @Post('evidence')
  @HttpCode(200)
  @Responds(EvidenceView)
  async evidence(@Req() request: RawBodyRequest<Request>) {
    const header = request.headers['x-nextcloud-signature']
    const signature = Array.isArray(header) ? header[0] : header
    if (!request.rawBody || !verifyWebhookSignature(this.env.NEXTCLOUD_WEBHOOK_SECRET, request.rawBody, signature)) {
      throw new DomainError(PlatformErrors.WEBHOOK_SIGNATURE_INVALID, {})
    }
    const parsed = NextcloudEvidenceWebhook.safeParse(request.body)
    if (!parsed.success) {
      throw new DomainError(PlatformErrors.VALIDATION_FAILED, { issues: parsed.error.issues })
    }
    try {
      return await this.registerUseCase.execute(parsed.data)
    } catch (error) {
      // El mismo archivo entregado dos veces (reintento de Nextcloud) es éxito, no error: se trata como idempotente.
      // Lectura simple (`db`, no `tx`): la transacción de registerUseCase ya se revirtió en este punto, no hay
      // ninguna activa que esta lectura debiera ver (docs/02 §... regla de acceso a BD: InjectTx solo junto a
      // @Transactional en métodos que escriben).
      if (error instanceof DomainError && error.code === AuditErrors.EVIDENCE_ALREADY_REGISTERED.code) {
        return await findEvidenceByStorageFileId(this.db, parsed.data.fileId)
      }
      throw error
    }
  }
}
