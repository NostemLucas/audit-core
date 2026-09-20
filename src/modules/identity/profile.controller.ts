import { Controller, Get } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../platform/auth/index.js'
import { NoAbilityRequired } from '../../platform/authz/index.js'
import { Responds } from '../../platform/http/index.js'
import { GetProfileUseCase } from './use-cases/get-profile.use-case.js'
import { ProfileView } from './profile.schemas.js'

@Controller('profile')
export class ProfileController {
  constructor(private readonly getProfile: GetProfileUseCase) {}

  /** Quién soy y qué puedo hacer. Cualquier usuario autenticado, aunque no tenga ningún rol. */
  @Get()
  @NoAbilityRequired()
  @Responds(ProfileView)
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.getProfile.execute(user)
  }
}
