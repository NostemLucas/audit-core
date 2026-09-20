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

@Module({
  controllers: [ScalesController],
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
  ],
})
export class LibraryModule {}
