import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import { GenerateReport, type GenerateReportT, ReportId, ReportView, ReportWithDownload } from './reports.schemas.js'
import { GenerateReportUseCase } from './use-cases/generate-report.use-case.js'
import { GetReportUseCase } from './use-cases/get-report.use-case.js'
import { ListReportsUseCase } from './use-cases/list-reports.use-case.js'

/**
 * Informes de una auditoría (docs/07 §2): la plantilla se rellena con los mismos datos que `GET /results` y `/gaps`.
 * (Tier B, docs/02 §4 — no Tier C pese al nombre: generar SÍ escribe, `Report` + la subida a Nextcloud; sin
 * repositorio ni `domain/` propio, la validación vive en `report-template-validation.ts` como un `.rules.ts`.)
 */
@Controller('audits/:auditId/reports')
export class ReportsController {
  constructor(
    private readonly generateUseCase: GenerateReportUseCase,
    private readonly listUseCase: ListReportsUseCase,
    private readonly getUseCase: GetReportUseCase,
  ) {}

  /** El manager o el líder genera un informe con el estado actual de la auditoría. */
  @Post()
  @HttpCode(201)
  @Can('create', 'Report')
  @Responds(ReportView, { status: 201 })
  generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Body({ schema: GenerateReport }) body: GenerateReportT,
  ) {
    return this.generateUseCase.execute(actor, auditId, body)
  }

  @Get()
  @Can('read', 'Report')
  @Responds(ReportView, { kind: 'list' })
  list(@CurrentUser() actor: AuthenticatedUser, @Param('auditId', { schema: AuditId }) auditId: string) {
    return this.listUseCase.execute(actor, auditId)
  }

  @Get(':reportId')
  @Can('read', 'Report')
  @Responds(ReportWithDownload)
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('reportId', { schema: ReportId }) reportId: string,
  ) {
    return this.getUseCase.execute(actor, auditId, reportId)
  }
}
