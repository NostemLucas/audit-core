import { Module } from '@nestjs/common'
import { OrganizationsReader } from './organizations.reader.js'
import { OrganizationsController } from './organizations.controller.js'
import { CreateOrganizationUseCase } from './use-cases/create-organization.use-case.js'
import { DeleteOrganizationUseCase } from './use-cases/delete-organization.use-case.js'
import { GetOrganizationUseCase } from './use-cases/get-organization.use-case.js'
import { ListOrganizationsUseCase } from './use-cases/list-organizations.use-case.js'
import { RenameOrganizationUseCase } from './use-cases/rename-organization.use-case.js'
import { SetOrganizationAvailabilityUseCase } from './use-cases/set-organization-availability.use-case.js'

@Module({
  controllers: [OrganizationsController],
  providers: [
    ListOrganizationsUseCase,
    GetOrganizationUseCase,
    CreateOrganizationUseCase,
    RenameOrganizationUseCase,
    SetOrganizationAvailabilityUseCase,
    DeleteOrganizationUseCase,
    OrganizationsReader,
  ],
  exports: [OrganizationsReader],
})
export class OrganizationsModule {}
