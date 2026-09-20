import { Injectable } from '@nestjs/common'
import { packRules } from '@casl/ability/extra'
import type { AuthenticatedUser } from '../../platform/auth/index.js'
import { defineAbilityFor } from '../../platform/authz/index.js'
import type { ProfileViewT } from './profile.schemas.js'

@Injectable()
export class GetProfileUseCase {
  execute(user: AuthenticatedUser): ProfileViewT {
    return {
      user: { id: user.id, email: user.email, username: user.username, name: user.name, roles: [...user.roles] },
      abilities: packRules(defineAbilityFor(user.roles).rules) as unknown[][],
    }
  }
}
