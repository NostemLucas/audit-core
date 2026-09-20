import { Global, Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { AbilitiesGuard } from './abilities.guard.js'
import { RouteProtectionCheck } from './route-protection.check.js'

@Global()
@Module({ imports: [DiscoveryModule], providers: [AbilitiesGuard, RouteProtectionCheck], exports: [AbilitiesGuard] })
export class AuthzModule {}
