import { Global, Module } from '@nestjs/common'
import { CLOCK, systemClock } from './clock.js'

@Global()
@Module({ providers: [{ provide: CLOCK, useValue: systemClock }], exports: [CLOCK] })
export class ClockModule {}
