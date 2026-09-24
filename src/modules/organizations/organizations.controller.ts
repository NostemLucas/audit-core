import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { Can } from '../../platform/authz/index.js'
import { Responds } from '../../platform/http/index.js'
import { CreateOrganizationUseCase } from './use-cases/create-organization.use-case.js'
import { DeleteOrganizationUseCase } from './use-cases/delete-organization.use-case.js'
import { GetOrganizationUseCase } from './use-cases/get-organization.use-case.js'
import { ListOrganizationsUseCase } from './use-cases/list-organizations.use-case.js'
import { RenameOrganizationUseCase } from './use-cases/rename-organization.use-case.js'
import { SetOrganizationAvailabilityUseCase } from './use-cases/set-organization-availability.use-case.js'
import {
  CreateOrganization,
  type CreateOrganizationT,
  ListOrganizationsQuery,
  type ListOrganizationsQueryT,
  OrganizationId,
  OrganizationView,
  UpdateOrganization,
  type UpdateOrganizationT,
} from './organization.schemas.js'

/** A quién se audita: nombre y si se puede elegir para auditorías nuevas. (Tier B, docs/02 §4) */
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly list: ListOrganizationsUseCase,
    private readonly get: GetOrganizationUseCase,
    private readonly create: CreateOrganizationUseCase,
    private readonly rename: RenameOrganizationUseCase,
    private readonly availability: SetOrganizationAvailabilityUseCase,
    private readonly remove: DeleteOrganizationUseCase,
  ) {}

  @Get()
  @Can('read', 'Organization')
  @Responds(OrganizationView, { kind: 'page' })
  findAll(@Query({ schema: ListOrganizationsQuery }) query: ListOrganizationsQueryT) {
    return this.list.execute(query)
  }

  @Get(':id')
  @Can('read', 'Organization')
  @Responds(OrganizationView)
  findOne(@Param('id', { schema: OrganizationId }) id: string) {
    return this.get.execute(id)
  }

  @Post()
  @Can('create', 'Organization')
  @Responds(OrganizationView, { status: 201 })
  add(@Body({ schema: CreateOrganization }) body: CreateOrganizationT) {
    return this.create.execute(body)
  }

  @Patch(':id')
  @Can('update', 'Organization')
  @Responds(OrganizationView)
  update(
    @Param('id', { schema: OrganizationId }) id: string,
    @Body({ schema: UpdateOrganization }) body: UpdateOrganizationT,
  ) {
    return this.rename.execute(id, body)
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Can('update', 'Organization')
  @Responds(OrganizationView)
  activate(@Param('id', { schema: OrganizationId }) id: string) {
    return this.availability.execute(id, true)
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Can('update', 'Organization')
  @Responds(OrganizationView)
  deactivate(@Param('id', { schema: OrganizationId }) id: string) {
    return this.availability.execute(id, false)
  }

  @Delete(':id')
  @HttpCode(204)
  @Can('delete', 'Organization')
  async delete(@Param('id', { schema: OrganizationId }) id: string) {
    await this.remove.execute(id)
  }
}
