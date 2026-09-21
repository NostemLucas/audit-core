import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { CreateControlUseCase } from './use-cases/create-control.use-case.js'
import { DeleteControlUseCase } from './use-cases/delete-control.use-case.js'
import { ListControlsUseCase } from './use-cases/list-controls.use-case.js'
import { MoveControlUseCase } from './use-cases/move-control.use-case.js'
import { UpdateControlUseCase } from './use-cases/update-control.use-case.js'
import {
  ControlId,
  ControlView,
  CreateControl,
  type CreateControlT,
  MoveControl,
  type MoveControlT,
  UpdateControl,
  type UpdateControlT,
} from './control.schemas.js'
import { TemplateId } from './template.schemas.js'

/** Los controles de una plantilla. Las operaciones que cambian el árbol devuelven la lista completa (las posiciones de los hermanos cambian). */
@Controller('templates/:templateId/controls')
export class ControlsController {
  constructor(
    private readonly list: ListControlsUseCase,
    private readonly create: CreateControlUseCase,
    private readonly update: UpdateControlUseCase,
    private readonly move: MoveControlUseCase,
    private readonly remove: DeleteControlUseCase,
  ) {}

  @Get()
  @Can('read', 'Template')
  @Responds(ControlView, { kind: 'list' })
  findAll(@Param('templateId', { schema: TemplateId }) templateId: string) {
    return this.list.execute(templateId)
  }

  @Post()
  @Can('update', 'Template')
  @Responds(ControlView, { kind: 'list', status: 201 })
  add(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Body({ schema: CreateControl }) body: CreateControlT,
  ) {
    return this.create.execute(templateId, body)
  }

  @Patch(':controlId')
  @Can('update', 'Template')
  @Responds(ControlView)
  edit(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
    @Body({ schema: UpdateControl }) body: UpdateControlT,
  ) {
    return this.update.execute(templateId, controlId, body)
  }

  @Post(':controlId/move')
  @HttpCode(200)
  @Can('update', 'Template')
  @Responds(ControlView, { kind: 'list' })
  relocate(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
    @Body({ schema: MoveControl }) body: MoveControlT,
  ) {
    return this.move.execute(templateId, controlId, body)
  }

  @Delete(':controlId')
  @Can('update', 'Template')
  @Responds(ControlView, { kind: 'list' })
  delete(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
  ) {
    return this.remove.execute(templateId, controlId)
  }
}
