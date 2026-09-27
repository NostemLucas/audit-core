import { Global, Module } from '@nestjs/common'
import { USER_RESOLVER } from '../../platform/auth/index.js'
import { AuthentikUserResolver } from './authentik/authentik-user-resolver.js'
import { GetProfileUseCase } from './use-cases/get-profile.use-case.js'
import { ListUsersUseCase } from './use-cases/list-users.use-case.js'
import { ProfileController } from './profile.controller.js'
import { UsersController } from './users.controller.js'
import { UserDirectory } from './user-directory.js'

/** Global porque implementa el puerto `USER_RESOLVER` que `platform/auth` consume sin conocer este módulo. */
@Global()
@Module({
  controllers: [ProfileController, UsersController],
  providers: [
    AuthentikUserResolver,
    { provide: USER_RESOLVER, useExisting: AuthentikUserResolver },
    GetProfileUseCase,
    ListUsersUseCase,
    UserDirectory,
  ],
  exports: [USER_RESOLVER, UserDirectory],
})
export class IdentityModule {}
