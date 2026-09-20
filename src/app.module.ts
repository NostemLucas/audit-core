import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import './app-errors.js' // registra el catálogo de errores completo (lo necesita el traductor de errores de la BD)
import './app-events.js' // registra el catálogo de eventos completo
import { ENV, EnvModule, type Env } from './platform/config/index.js'
import { ContextModule } from './platform/context/context.module.js'
import { DbModule } from './platform/db/index.js'
import { EventsModule } from './platform/events/index.js'
import { HealthController } from './platform/health/health.controller.js'
import { LoggingModule } from './platform/logging/index.js'

@Module({
  imports: [
    EnvModule,
    LoggingModule,
    DbModule,
    ContextModule,
    EventsModule,
    ThrottlerModule.forRootAsync({
      imports: [], // EnvModule es global
      inject: [ENV],
      useFactory: (env: Env) => ({ throttlers: [{ ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT }] }),
    }),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
