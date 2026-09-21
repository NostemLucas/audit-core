import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import {
  AuditId,
  AuditView,
  CreateAudit,
  type CreateAuditT,
  ListAuditsQuery,
  type ListAuditsQueryT,
  TransferAudit,
  type TransferAuditT,
  UpdateAudit,
  type UpdateAuditT,
} from './audit.schemas.js'
import { CreateAuditUseCase } from './use-cases/create-audit.use-case.js'
import { DeleteAuditUseCase } from './use-cases/delete-audit.use-case.js'
import { GetAuditUseCase } from './use-cases/get-audit.use-case.js'
import { ListAuditsUseCase } from './use-cases/list-audits.use-case.js'
import { ArchiveAuditUseCase } from './use-cases/archive-audit.use-case.js'
import { CloseAuditUseCase } from './use-cases/close-audit.use-case.js'
import { StartAuditUseCase } from './use-cases/start-audit.use-case.js'
import { TransferAuditUseCase } from './use-cases/transfer-audit.use-case.js'
import { UpdateAuditUseCase } from './use-cases/update-audit.use-case.js'

/**
 * Los permisos globales (`@Can`) deciden si la ruta se puede llamar; lo que depende de ESTA auditoría (¿soy su manager?
 * ¿su líder? ¿miembro?) lo decide cada caso de uso con `audit-policy.ts` (docs/06 §1).
 */
@Controller('audits')
export class AuditsController {
  constructor(
    private readonly list: ListAuditsUseCase,
    private readonly get: GetAuditUseCase,
    private readonly create: CreateAuditUseCase,
    private readonly update: UpdateAuditUseCase,
    private readonly remove: DeleteAuditUseCase,
    private readonly transferAudit: TransferAuditUseCase,
    private readonly startAudit: StartAuditUseCase,
    private readonly closeAudit: CloseAuditUseCase,
    private readonly archiveAudit: ArchiveAuditUseCase,
  ) {}

  @Get()
  @Can('read', 'Audit')
  @Responds(AuditView, { kind: 'page' })
  findAll(@CurrentUser() actor: AuthenticatedUser, @Query({ schema: ListAuditsQuery }) query: ListAuditsQueryT) {
    return this.list.execute(actor, query)
  }

  @Get(':id')
  @Can('read', 'Audit')
  @Responds(AuditView)
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: AuditId }) id: string) {
    return this.get.execute(actor, id)
  }

  @Post()
  @Can('create', 'Audit')
  @Responds(AuditView, { status: 201 })
  add(@CurrentUser() actor: AuthenticatedUser, @Body({ schema: CreateAudit }) body: CreateAuditT) {
    return this.create.execute(actor, body)
  }

  @Patch(':id')
  @Can('update', 'Audit')
  @Responds(AuditView)
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: AuditId }) id: string,
    @Body({ schema: UpdateAudit }) body: UpdateAuditT,
  ) {
    return this.update.execute(actor, id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  @Can('delete', 'Audit')
  async delete(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: AuditId }) id: string): Promise<void> {
    await this.remove.execute(actor, id)
  }

  @Post(':id/start')
  @HttpCode(200)
  @Can('update', 'Audit')
  @Responds(AuditView)
  start(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: AuditId }) id: string) {
    return this.startAudit.execute(actor, id)
  }

  @Post(':id/close')
  @HttpCode(200)
  @Can('update', 'Audit')
  @Responds(AuditView)
  close(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: AuditId }) id: string) {
    return this.closeAudit.execute(actor, id)
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Can('update', 'Audit')
  @Responds(AuditView)
  archive(@CurrentUser() actor: AuthenticatedUser, @Param('id', { schema: AuditId }) id: string) {
    return this.archiveAudit.execute(actor, id)
  }

  /**
   * Pasa la auditoría a otro manager. Solo el ADMIN (lo comprueba `audit-policy`, no CASL: el GERENTE también puede `read Audit`).
   */
  @Post(':id/transfer')
  @HttpCode(200)
  @Can('read', 'Audit')
  @Responds(AuditView)
  transfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: AuditId }) id: string,
    @Body({ schema: TransferAudit }) body: TransferAuditT,
  ) {
    return this.transferAudit.execute(actor, id, body)
  }
}
