import { Global, Module } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import type { DestinationStream } from 'pino'
import '../context/cls-store.js'
import { ENV, type Env } from '../config/index.js'
import { AppLogger } from './app-logger.js'
import { createPino } from './create-pino.js'
import { LOG_DESTINATION, PINO } from './tokens.js'

@Global()
@Module({
  providers: [
    { provide: LOG_DESTINATION, useValue: null },
    {
      provide: PINO,
      inject: [ENV, ClsService, { token: LOG_DESTINATION, optional: true }],
      useFactory: (env: Env, cls: ClsService, destination: DestinationStream | null) =>
        createPino({
          level: env.LOG_LEVEL,
          pretty: env.LOG_PRETTY,
          destination: destination ?? undefined,
          getContext: () =>
            cls.isActive() ? { correlationId: cls.get('correlationId'), userId: cls.get('userId') } : {},
        }),
    },
    AppLogger,
  ],
  exports: [AppLogger, PINO, LOG_DESTINATION],
})
export class LoggingModule {}
