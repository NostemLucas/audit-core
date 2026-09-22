import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiOkResponse, ApiProduces } from '@nestjs/swagger'
import { Can } from '../../../platform/authz/index.js'
import { attachment, Responds, YAML_MIME } from '../../../platform/http/index.js'
import { LIMITS } from '../../../shared/limits.js'
import { ControlId } from './control.schemas.js'
import { ExportSuggestedFindingsUseCase } from './use-cases/export-suggested-findings.use-case.js'
import { GetSuggestedFindingsMatrixUseCase } from './use-cases/get-suggested-findings-matrix.use-case.js'
import { ImportSuggestedFindingsUseCase } from './use-cases/import-suggested-findings.use-case.js'
import { RemoveSuggestedFindingUseCase } from './use-cases/remove-suggested-finding.use-case.js'
import { SetSuggestedFindingUseCase } from './use-cases/set-suggested-finding.use-case.js'
import {
  ImportMatrixBody,
  type ImportMatrixBodyT,
  ImportMatrixResult,
  LevelId,
  MatrixQuery,
  type MatrixQueryT,
  SetSuggestedFinding,
  type SetSuggestedFindingT,
  SuggestedFindingsMatrixView,
  SuggestedFindingView,
} from './suggested-finding.schemas.js'
import { TemplateId } from './template.schemas.js'

/**
 * Hallazgos sugeridos: ayuda de redacción por (control, opción de escala). Se editan en cualquier estado de la plantilla
 * (ver SetSuggestedFindingUseCase).
 */
@Controller('templates/:templateId')
export class SuggestedFindingsController {
  constructor(
    private readonly matrix: GetSuggestedFindingsMatrixUseCase,
    private readonly set: SetSuggestedFindingUseCase,
    private readonly remove: RemoveSuggestedFindingUseCase,
    private readonly exportMatrix: ExportSuggestedFindingsUseCase,
    private readonly importMatrix: ImportSuggestedFindingsUseCase,
  ) {}

  @Get('suggested-findings')
  @Can('read', 'Template')
  @Responds(SuggestedFindingsMatrixView)
  getMatrix(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Query({ schema: MatrixQuery }) query: MatrixQueryT,
  ) {
    return this.matrix.execute(templateId, query.scaleId)
  }

  /** La matriz de una escala como YAML: se completa y se vuelve a subir con `POST …/import`. */
  @Get('suggested-findings/export')
  @Can('read', 'Template')
  @ApiProduces(YAML_MIME)
  @ApiOkResponse({
    description: 'La matriz como YAML',
    content: { [YAML_MIME]: { schema: { type: 'string', format: 'binary' } } },
  })
  async export(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Query({ schema: MatrixQuery }) query: MatrixQueryT,
  ): Promise<StreamableFile> {
    const { buffer, name } = await this.exportMatrix.execute(templateId, query.scaleId)
    return new StreamableFile(buffer, { type: YAML_MIME, disposition: attachment(name, 'yaml') })
  }

  /** Solo agrega o cambia sugerencias (una celda vacía no borra). Todo o nada. Multipart: `file`. */
  @Post('suggested-findings/import')
  @Can('update', 'Template')
  @Responds(ImportMatrixResult, { status: 201 })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LIMITS.importBytes, files: 1 } }))
  import(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Query({ schema: MatrixQuery }) query: MatrixQueryT,
    // Opcional: una petición sin cuerpo tampoco trae archivo, y eso se responde igual (422 "Falta el archivo").
    @Body({ schema: ImportMatrixBody.optional() }) _body: ImportMatrixBodyT | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    return this.importMatrix.execute({ templateId, scaleId: query.scaleId, file: file?.buffer })
  }

  @Put('controls/:controlId/suggested-findings/:levelId')
  @Can('update', 'Template')
  @Responds(SuggestedFindingView)
  put(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
    @Param('levelId', { schema: LevelId }) levelId: string,
    @Body({ schema: SetSuggestedFinding }) body: SetSuggestedFindingT,
  ) {
    return this.set.execute(templateId, controlId, levelId, body)
  }

  @Delete('controls/:controlId/suggested-findings/:levelId')
  @HttpCode(204)
  @Can('update', 'Template')
  async delete(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
    @Param('levelId', { schema: LevelId }) levelId: string,
  ): Promise<void> {
    await this.remove.execute(templateId, controlId, levelId)
  }
}
