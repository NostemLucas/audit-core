import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

/** Liveness: el proceso responde. (Readiness, con la base de datos, llega con el cliente Prisma.) */
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' }
  }
}
