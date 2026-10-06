import { Controller, Get, Param, Query } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import { ListAuditFilesQuery, type ListAuditFilesQueryT, ListAuditFilesView } from './audit-files.schemas.js'
import { ListAuditFilesUseCase } from './list-audit-files.use-case.js'

/**
 * Carpetas de Nextcloud de una auditoría para navegarlas en el frontend (solo lectura, docs/07 §1.5).
 * (Tier C, docs/02 §4: solo lectura, sin reglas de negocio ni escritura.)
 */
@Controller('audits/:auditId/files')
export class AuditFilesController {
  constructor(private readonly listUseCase: ListAuditFilesUseCase) {}

  @Get()
  @Can('read', 'Evidence')
  @Responds(ListAuditFilesView)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Query({ schema: ListAuditFilesQuery }) query: ListAuditFilesQueryT,
  ) {
    return this.listUseCase.execute(actor, auditId, query)
  }
}
