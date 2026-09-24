import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiOkResponse, ApiProduces } from '@nestjs/swagger'
import { Can } from '../../../platform/authz/index.js'
import { attachment, DOCX_MIME, Responds } from '../../../platform/http/index.js'
import { LIMITS } from '../../../shared/limits.js'
import {
  ReportTemplateId,
  ReportTemplateView,
  UploadReportTemplateBody,
  type UploadReportTemplateBodyT,
  UploadReportTemplateQuery,
  type UploadReportTemplateQueryT,
  UploadReportTemplateResult,
} from './report-template.schemas.js'
import { DeleteReportTemplateUseCase } from './use-cases/delete-report-template.use-case.js'
import { GetReportTemplateUseCase } from './use-cases/get-report-template.use-case.js'
import { ListReportTemplatesUseCase } from './use-cases/list-report-templates.use-case.js'
import { UploadReportTemplateUseCase } from './use-cases/upload-report-template.use-case.js'

/**
 * Plantillas de informe personalizadas por tipo (y, opcionalmente, dimensión de escala) — docs/07 §2. No confundir
 * con `ReportsController`: eso son los informes YA generados; esto es la plantilla `.docx` que los genera.
 * (Tier B, docs/02 §4: mismo corte que `reports.controller.ts`.)
 */
@Controller('report-templates')
export class ReportTemplatesController {
  constructor(
    private readonly uploadUseCase: UploadReportTemplateUseCase,
    private readonly listUseCase: ListReportTemplatesUseCase,
    private readonly getUseCase: GetReportTemplateUseCase,
    private readonly deleteUseCase: DeleteReportTemplateUseCase,
  ) {}

  /** Sube (o reemplaza) la plantilla de un tipo de informe. Multipart: `file`. */
  @Post()
  @HttpCode(201)
  @Can('create', 'ReportTemplate')
  @Responds(UploadReportTemplateResult, { status: 201 })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LIMITS.importBytes, files: 1 } }))
  upload(
    @Query({ schema: UploadReportTemplateQuery }) query: UploadReportTemplateQueryT,
    // Opcional: una petición sin cuerpo tampoco trae archivo, y eso se responde igual (422 "Falta el archivo").
    @Body({ schema: UploadReportTemplateBody.optional() }) _body: UploadReportTemplateBodyT | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    return this.uploadUseCase.execute({ type: query.type, dimension: query.dimension, file: file?.buffer })
  }

  @Get()
  @Can('read', 'ReportTemplate')
  @Responds(ReportTemplateView, { kind: 'list' })
  list() {
    return this.listUseCase.execute()
  }

  /** El .docx tal como se subió, para editarlo y volver a subirlo. */
  @Get(':id')
  @Can('read', 'ReportTemplate')
  @ApiProduces(DOCX_MIME)
  @ApiOkResponse({
    description: 'La plantilla como .docx',
    content: { [DOCX_MIME]: { schema: { type: 'string', format: 'binary' } } },
  })
  async get(@Param('id', { schema: ReportTemplateId }) id: string): Promise<StreamableFile> {
    const { content, type } = await this.getUseCase.execute(id)
    return new StreamableFile(content, { type: DOCX_MIME, disposition: attachment(type, 'docx') })
  }

  /** Vuelve a la plantilla de fábrica para ese (type, dimension). */
  @Delete(':id')
  @HttpCode(204)
  @Can('delete', 'ReportTemplate')
  async delete(@Param('id', { schema: ReportTemplateId }) id: string): Promise<void> {
    await this.deleteUseCase.execute(id)
  }
}
