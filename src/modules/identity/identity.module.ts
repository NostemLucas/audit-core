import { Global, Module } from '@nestjs/common'
import { USER_RESOLVER } from '../../platform/auth/index.js'
import { AuthentikUserResolver } from './authentik/authentik-user-resolver.js'
import { GetProfileUseCase } from './use-cases/get-profile.use-case.js'
import { ProfileController } from './profile.controller.js'

/** Global porque implementa el puerto `USER_RESOLVER` que `platform/auth` consume sin conocer este módulo. */
@Global()
@Module({
  controllers: [ProfileController],
  providers: [AuthentikUserResolver, { provide: USER_RESOLVER, useExisting: AuthentikUserResolver }, GetProfileUseCase],
  exports: [USER_RESOLVER],
})
export class IdentityModule {}
