import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiOkResponse, ApiProduces } from '@nestjs/swagger'
import { Can } from '../../../platform/authz/index.js'
import { attachment, Responds, XLSX_MIME } from '../../../platform/http/index.js'
import { LIMITS } from '../../../shared/limits.js'
import { ArchiveTemplateUseCase } from './use-cases/archive-template.use-case.js'
import { CloneTemplateUseCase } from './use-cases/clone-template.use-case.js'
import { CreateTemplateUseCase } from './use-cases/create-template.use-case.js'
import { DeleteTemplateUseCase } from './use-cases/delete-template.use-case.js'
import { ExportTemplateUseCase } from './use-cases/export-template.use-case.js'
import { GetTemplateUseCase } from './use-cases/get-template.use-case.js'
import { ImportTemplateUseCase } from './use-cases/import-template.use-case.js'
import { ListTemplatesUseCase } from './use-cases/list-templates.use-case.js'
import { PublishTemplateUseCase } from './use-cases/publish-template.use-case.js'
import { RenameTemplateUseCase } from './use-cases/rename-template.use-case.js'
import {
  CloneTemplate,
  type CloneTemplateT,
  CreateTemplate,
  type CreateTemplateT,
  ImportTemplateBody,
  type ImportTemplateBodyT,
  ImportTemplateResult,
  ListTemplatesQuery,
  type ListTemplatesQueryT,
  TemplateId,
  TemplateView,
  UpdateTemplate,
  type UpdateTemplateT,
} from './template.schemas.js'

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly list: ListTemplatesUseCase,
    private readonly get: GetTemplateUseCase,
    private readonly create: CreateTemplateUseCase,
    private readonly rename: RenameTemplateUseCase,
    private readonly remove: DeleteTemplateUseCase,
    private readonly publishTemplate: PublishTemplateUseCase,
    private readonly archiveTemplate: ArchiveTemplateUseCase,
    private readonly importTemplate: ImportTemplateUseCase,
    private readonly exportTemplate: ExportTemplateUseCase,
    private readonly cloneTemplate: CloneTemplateUseCase,
  ) {}

  @Get()
  @Can('read', 'Template')
  @Responds(TemplateView, { kind: 'page' })
  findAll(@Query({ schema: ListTemplatesQuery }) query: ListTemplatesQueryT) {
    return this.list.execute(query)
  }

  @Get(':id')
  @Can('read', 'Template')
  @Responds(TemplateView)
  findOne(@Param('id', { schema: TemplateId }) id: string) {
    return this.get.execute(id)
  }

  @Post()
  @Can('create', 'Template')
  @Responds(TemplateView, { status: 201 })
  add(@Body({ schema: CreateTemplate }) body: CreateTemplateT) {
    return this.create.execute(body)
  }

  @Patch(':id')
  @Can('update', 'Template')
  @Responds(TemplateView)
  update(@Param('id', { schema: TemplateId }) id: string, @Body({ schema: UpdateTemplate }) body: UpdateTemplateT) {
    return this.rename.execute(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  @Can('delete', 'Template')
  async delete(@Param('id', { schema: TemplateId }) id: string) {
    await this.remove.execute(id)
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Can('update', 'Template')
  @Responds(TemplateView)
  publish(@Param('id', { schema: TemplateId }) id: string) {
    return this.publishTemplate.execute(id)
  }

  /** Copia la plantilla (árbol y hallazgos sugeridos) a una NUEVA en borrador; el origen no cambia. */
  @Post(':id/clone')
  @Can('create', 'Template')
  @Responds(TemplateView, { status: 201 })
  clone(@Param('id', { schema: TemplateId }) id: string, @Body({ schema: CloneTemplate }) body: CloneTemplateT) {
    return this.cloneTemplate.execute(id, body)
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Can('update', 'Template')
  @Responds(TemplateView)
  archive(@Param('id', { schema: TemplateId }) id: string) {
    return this.archiveTemplate.execute(id)
  }

  /** Crea una plantilla nueva (borrador) desde un Excel. Multipart: `file` y, opcionalmente, `name`. */
  @Post('import')
  @Can('create', 'Template')
  @Responds(ImportTemplateResult, { status: 201 })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LIMITS.importBytes, files: 1 } }))
  // El cuerpo es opcional: una petición sin cuerpo tampoco trae archivo, y eso se responde igual (422 "Falta el archivo").
  import(
    @Body({ schema: ImportTemplateBody.optional() }) body: ImportTemplateBodyT | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    return this.importTemplate.execute({ name: body?.name, file: file?.buffer })
  }

  @Get(':id/export')
  @Can('read', 'Template')
  @ApiProduces(XLSX_MIME)
  @ApiOkResponse({
    description: 'La plantilla como Excel',
    content: { [XLSX_MIME]: { schema: { type: 'string', format: 'binary' } } },
  })
  async export(@Param('id', { schema: TemplateId }) id: string): Promise<StreamableFile> {
    const { buffer, name } = await this.exportTemplate.execute(id)
    return new StreamableFile(buffer, { type: XLSX_MIME, disposition: attachment(name, 'xlsx') })
  }
}
