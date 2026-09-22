import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import './app-errors.js' // registra el catálogo de errores completo (lo necesita el traductor de errores de la BD)
import './app-events.js' // registra el catálogo de eventos completo
import { AuditsModule } from './modules/audits/index.js'
import { DashboardModule } from './modules/dashboard/index.js'
import { IdentityModule } from './modules/identity/index.js'
import { LibraryModule } from './modules/library/index.js'
import { OrganizationsModule } from './modules/organizations/index.js'
import { AuthGuard, AuthModule } from './platform/auth/index.js'
import { AbilitiesGuard, AuthzModule } from './platform/authz/index.js'
import { ClockModule } from './platform/clock/index.js'
import { ENV, EnvModule, type Env } from './platform/config/index.js'
import { ContextModule } from './platform/context/context.module.js'
import { DbModule } from './platform/db/index.js'
import { EventsModule } from './platform/events/index.js'
import { HealthController } from './platform/health/health.controller.js'
import { LoggingModule } from './platform/logging/index.js'
import { NextcloudModule } from './platform/nextcloud/index.js'

@Module({
  imports: [
    EnvModule,
    LoggingModule,
    DbModule,
    ContextModule,
    EventsModule,
    ClockModule,
    NextcloudModule,
    AuthModule,
    AuthzModule,
    IdentityModule,
    OrganizationsModule,
    LibraryModule,
    AuditsModule,
    DashboardModule,
    ThrottlerModule.forRootAsync({
      imports: [], // EnvModule es global
      inject: [ENV],
      useFactory: (env: Env) => ({ throttlers: [{ ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT }] }),
    }),
  ],
  controllers: [HealthController],
  providers: [
    // El ORDEN importa: primero el límite de peticiones, luego quién eres, luego qué puedes hacer.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AbilitiesGuard },
  ],
})
export class AppModule {}
