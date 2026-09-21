import { Module } from '@nestjs/common'
import { LibraryModule } from '../library/index.js'
import { OrganizationsModule } from '../organizations/index.js'
import { AuditHistoryRecorder } from './audit-history.recorder.js'
import { AuditsController } from './lifecycle/audits.controller.js'
import { CreateAuditUseCase } from './lifecycle/use-cases/create-audit.use-case.js'
import { DeleteAuditUseCase } from './lifecycle/use-cases/delete-audit.use-case.js'
import { GetAuditUseCase } from './lifecycle/use-cases/get-audit.use-case.js'
import { ListAuditsUseCase } from './lifecycle/use-cases/list-audits.use-case.js'
import { UpdateAuditUseCase } from './lifecycle/use-cases/update-audit.use-case.js'
import { ScopeController } from './scope/scope.controller.js'
import { AddScopeItemUseCase } from './scope/use-cases/add-scope-item.use-case.js'
import { RemoveScopeItemUseCase } from './scope/use-cases/remove-scope-item.use-case.js'

/** `identity` es global (UserDirectory); `organizations` y `library` se importan por su API pública (sus lectores). */
@Module({
  imports: [OrganizationsModule, LibraryModule],
  controllers: [AuditsController, ScopeController],
  providers: [
    AuditHistoryRecorder,
    ListAuditsUseCase,
    GetAuditUseCase,
    CreateAuditUseCase,
    UpdateAuditUseCase,
    DeleteAuditUseCase,
    AddScopeItemUseCase,
    RemoveScopeItemUseCase,
  ],
})
export class AuditsModule {}
