import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { CreateTemplateUseCase } from './use-cases/create-template.use-case.js'
import { DeleteTemplateUseCase } from './use-cases/delete-template.use-case.js'
import { GetTemplateUseCase } from './use-cases/get-template.use-case.js'
import { ListTemplatesUseCase } from './use-cases/list-templates.use-case.js'
import { RenameTemplateUseCase } from './use-cases/rename-template.use-case.js'
import {
  CreateTemplate,
  type CreateTemplateT,
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
}
