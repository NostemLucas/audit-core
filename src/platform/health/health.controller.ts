import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../authz/index.js'
import { DB, type Db } from '../db/index.js'
import { FILE_STORAGE, type FileStoragePort } from '../nextcloud/index.js'
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

@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /** Liveness: el proceso responde. No toca dependencias, para que un fallo de BD no reinicie el proceso. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' }
  }

  /**
   * Readiness: las dependencias obligatorias responden. La base de datos es obligatoria (503 si no). Nextcloud se
   * informa pero no bloquea: sin él no se puede subir evidencia ni generar informes, pero el resto de la API funciona
   * (docs/07 §4) — el balanceador no debe sacar la instancia de servicio por eso.
   */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; checks: { database: 'up'; nextcloud: 'up' | 'down' } }> {
    try {
      await withTimeout(this.db.$queryRaw`SELECT 1`, READY_TIMEOUT_MS)
    } catch (cause) {
      throw new DomainError(PlatformErrors.SERVICE_UNAVAILABLE, { check: 'database' }, { cause })
    }
    const nextcloud = await withTimeout(this.storage.ping(), READY_TIMEOUT_MS)
      .then(() => 'up' as const)
      .catch(() => 'down' as const)
    return { status: 'ok', checks: { database: 'up', nextcloud } }
  }
}
