import { Module } from '@nestjs/common'
import { ScalesController } from './scales/scales.controller.js'
import { AddScaleLevelUseCase } from './scales/use-cases/add-scale-level.use-case.js'
import { CreateScaleUseCase } from './scales/use-cases/create-scale.use-case.js'
import { DeleteScaleUseCase } from './scales/use-cases/delete-scale.use-case.js'
import { GetScaleUseCase } from './scales/use-cases/get-scale.use-case.js'
import { ListScalesUseCase } from './scales/use-cases/list-scales.use-case.js'
import { RemoveScaleLevelUseCase } from './scales/use-cases/remove-scale-level.use-case.js'
import { RenameScaleUseCase } from './scales/use-cases/rename-scale.use-case.js'
import { SetScaleAvailabilityUseCase } from './scales/use-cases/set-scale-availability.use-case.js'
import { UpdateScaleLevelUseCase } from './scales/use-cases/update-scale-level.use-case.js'

import { ControlsController } from './templates/controls.controller.js'
import { TemplatesController } from './templates/templates.controller.js'
import { CreateControlUseCase } from './templates/use-cases/create-control.use-case.js'
import { CreateTemplateUseCase } from './templates/use-cases/create-template.use-case.js'
import { DeleteControlUseCase } from './templates/use-cases/delete-control.use-case.js'
import { DeleteTemplateUseCase } from './templates/use-cases/delete-template.use-case.js'
import { GetTemplateUseCase } from './templates/use-cases/get-template.use-case.js'
import { ListControlsUseCase } from './templates/use-cases/list-controls.use-case.js'
import { ListTemplatesUseCase } from './templates/use-cases/list-templates.use-case.js'
import { MoveControlUseCase } from './templates/use-cases/move-control.use-case.js'
import { RenameTemplateUseCase } from './templates/use-cases/rename-template.use-case.js'
import { UpdateControlUseCase } from './templates/use-cases/update-control.use-case.js'

@Module({
  controllers: [ScalesController, TemplatesController, ControlsController],
  providers: [
    ListScalesUseCase,
    GetScaleUseCase,
    CreateScaleUseCase,
    RenameScaleUseCase,
    SetScaleAvailabilityUseCase,
    DeleteScaleUseCase,
    AddScaleLevelUseCase,
    UpdateScaleLevelUseCase,
    RemoveScaleLevelUseCase,
    ListTemplatesUseCase,
    GetTemplateUseCase,
    CreateTemplateUseCase,
    RenameTemplateUseCase,
    DeleteTemplateUseCase,
    ListControlsUseCase,
    CreateControlUseCase,
    UpdateControlUseCase,
    MoveControlUseCase,
    DeleteControlUseCase,
  ],
})
export class LibraryModule {}
