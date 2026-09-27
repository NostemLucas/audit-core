import { Controller, Get, Query } from '@nestjs/common'
import { Can } from '../../platform/authz/index.js'
import { Responds } from '../../platform/http/index.js'
import { ListUsersUseCase } from './use-cases/list-users.use-case.js'
import { ListUsersQuery, type ListUsersQueryT, UserView } from './user.schemas.js'

/** Directorio de usuarios (espejo de Authentik), solo lectura: para elegir miembros de un equipo. (Tier B, docs/02 §4) */
@Controller('users')
export class UsersController {
  constructor(private readonly list: ListUsersUseCase) {}

  @Get()
  @Can('read', 'User')
  @Responds(UserView, { kind: 'page' })
  findAll(@Query({ schema: ListUsersQuery }) query: ListUsersQueryT) {
    return this.list.execute(query)
  }
}
