import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ENV, EnvModule, type Env } from './platform/config/index.js'
import { HealthController } from './platform/health/health.controller.js'

@Module({
  imports: [
    EnvModule,
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
