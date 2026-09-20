import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { DB, type Db } from '../db/index.js'
import { DomainError, PlatformErrors } from '../errors/index.js'

const READY_TIMEOUT_MS = 2_000

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sin respuesta en ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Liveness: el proceso responde. No toca dependencias, para que un fallo de BD no reinicie el proceso. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' }
  }

  /** Readiness: las dependencias obligatorias responden. Si no, 503 y el balanceador deja de enviar tráfico. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; checks: { database: 'up' } }> {
    try {
      await withTimeout(this.db.$queryRaw`SELECT 1`, READY_TIMEOUT_MS)
    } catch (cause) {
      throw new DomainError(PlatformErrors.SERVICE_UNAVAILABLE, { check: 'database' }, { cause })
    }
    return { status: 'ok', checks: { database: 'up' } }
  }
}
