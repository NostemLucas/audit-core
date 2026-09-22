import type { Provider, Type } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { AppModule } from '../../../src/app.module.js'
import { configureApp } from '../../../src/configure-app.js'
import { JWT_KEYS } from '../../../src/platform/auth/index.js'
import { ENV } from '../../../src/platform/config/index.js'
import { FILE_STORAGE, type FileStoragePort } from '../../../src/platform/nextcloud/index.js'
import { LOG_DESTINATION } from '../../../src/platform/logging/index.js'
import type { JWTVerifyGetKey } from 'jose'
import { testEnv } from '../../support/env.js'
import { databaseUrl } from './db.js'

/** La app real, con Postgres real. `extra` añade controladores/servicios de prueba. */
export async function createTestApp(
  extra: {
    controllers?: Type[]
    providers?: Provider[]
    databaseUrl?: string
    /** Resolutor de claves con el que se verifican los tokens (ver test/support/identity.ts). */
    jwtKeys?: JWTVerifyGetKey
    /** Captura las líneas de log. */
    logSink?: (line: Record<string, unknown>) => void
    /** Sustituye el cliente de Nextcloud (p. ej. `FakeFileStorage`). Sin esto, el adaptador real intenta hablar por red. */
    fileStorage?: FileStoragePort
  } = {},
): Promise<NestExpressApplication> {
  // En test el nivel por defecto es `silent`; si el test quiere capturar logs, se sube.
  const env = testEnv({
    DATABASE_URL: extra.databaseUrl ?? databaseUrl(),
    ...(extra.logSink && { LOG_LEVEL: 'debug' }),
  })
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  })
    .overrideProvider(ENV)
    .useValue(env)
  if (extra.jwtKeys) builder = builder.overrideProvider(JWT_KEYS).useValue(extra.jwtKeys)
  if (extra.fileStorage) builder = builder.overrideProvider(FILE_STORAGE).useValue(extra.fileStorage)
  const sink = extra.logSink
  if (sink)
    builder = builder.overrideProvider(LOG_DESTINATION).useValue({ write: (line: string) => sink(JSON.parse(line)) })
  const moduleRef = await builder.compile()

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  configureApp(app, env)
  await app.init()
  return app
}
