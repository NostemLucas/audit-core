import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AddScaleLevelUseCase } from './use-cases/add-scale-level.use-case.js'
import { CreateScaleUseCase } from './use-cases/create-scale.use-case.js'
import { DeleteScaleUseCase } from './use-cases/delete-scale.use-case.js'
import { GetScaleUseCase } from './use-cases/get-scale.use-case.js'
import { ListScalesUseCase } from './use-cases/list-scales.use-case.js'
import { RemoveScaleLevelUseCase } from './use-cases/remove-scale-level.use-case.js'
import { RenameScaleUseCase } from './use-cases/rename-scale.use-case.js'
import { SetScaleAvailabilityUseCase } from './use-cases/set-scale-availability.use-case.js'
import { UpdateScaleLevelUseCase } from './use-cases/update-scale-level.use-case.js'
import {
  AddScaleLevel,
  type AddScaleLevelT,
  CreateScale,
  type CreateScaleT,
  ListScalesQuery,
  type ListScalesQueryT,
  ScaleId,
  ScaleLevelId,
  ScaleView,
  UpdateScale,
  type UpdateScaleT,
  UpdateScaleLevel,
  type UpdateScaleLevelT,
} from './scale.schemas.js'

/** Escalas de calificación (niveles y su valor numérico), reutilizables entre auditorías. (Tier B, docs/02 §4) */
@Controller('scales')
export class ScalesController {
  constructor(
    private readonly list: ListScalesUseCase,
    private readonly get: GetScaleUseCase,
    private readonly create: CreateScaleUseCase,
    private readonly rename: RenameScaleUseCase,
    private readonly availability: SetScaleAvailabilityUseCase,
    private readonly remove: DeleteScaleUseCase,
    private readonly addLevel: AddScaleLevelUseCase,
    private readonly updateLevel: UpdateScaleLevelUseCase,
    private readonly removeLevel: RemoveScaleLevelUseCase,
  ) {}

  @Get()
  @Can('read', 'Scale')
  @Responds(ScaleView, { kind: 'page' })
  findAll(@Query({ schema: ListScalesQuery }) query: ListScalesQueryT) {
    return this.list.execute(query)
  }

  @Get(':id')
  @Can('read', 'Scale')
  @Responds(ScaleView)
  findOne(@Param('id', { schema: ScaleId }) id: string) {
    return this.get.execute(id)
  }

  @Post()
  @Can('create', 'Scale')
  @Responds(ScaleView, { status: 201 })
  add(@Body({ schema: CreateScale }) body: CreateScaleT) {
    return this.create.execute(body)
  }

  @Patch(':id')
  @Can('update', 'Scale')
  @Responds(ScaleView)
  update(@Param('id', { schema: ScaleId }) id: string, @Body({ schema: UpdateScale }) body: UpdateScaleT) {
    return this.rename.execute(id, body)
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Can('update', 'Scale')
  @Responds(ScaleView)
  activate(@Param('id', { schema: ScaleId }) id: string) {
    return this.availability.execute(id, true)
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Can('update', 'Scale')
  @Responds(ScaleView)
  deactivate(@Param('id', { schema: ScaleId }) id: string) {
    return this.availability.execute(id, false)
  }

  @Delete(':id')
  @HttpCode(204)
  @Can('delete', 'Scale')
  async delete(@Param('id', { schema: ScaleId }) id: string) {
    await this.remove.execute(id)
  }

  // ── Opciones. Devuelven la escala completa: el cliente refresca su vista con la respuesta. ─────────────────────
  @Post(':id/levels')
  @Can('update', 'Scale')
  @Responds(ScaleView, { status: 201 })
  addOption(@Param('id', { schema: ScaleId }) id: string, @Body({ schema: AddScaleLevel }) body: AddScaleLevelT) {
    return this.addLevel.execute(id, body)
  }

  @Patch(':id/levels/:levelId')
  @Can('update', 'Scale')
  @Responds(ScaleView)
  updateOption(
    @Param('id', { schema: ScaleId }) id: string,
    @Param('levelId', { schema: ScaleLevelId }) levelId: string,
    @Body({ schema: UpdateScaleLevel }) body: UpdateScaleLevelT,
  ) {
    return this.updateLevel.execute(id, levelId, body)
  }

  @Delete(':id/levels/:levelId')
  @Can('update', 'Scale')
  @Responds(ScaleView)
  removeOption(
    @Param('id', { schema: ScaleId }) id: string,
    @Param('levelId', { schema: ScaleLevelId }) levelId: string,
  ) {
    return this.removeLevel.execute(id, levelId)
  }
}
