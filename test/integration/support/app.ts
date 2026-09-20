import type { Provider, Type } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { AppModule } from '../../../src/app.module.js'
import { configureApp } from '../../../src/configure-app.js'
import { ENV } from '../../../src/platform/config/index.js'
import { testEnv } from '../../support/env.js'
import { databaseUrl } from './db.js'

/** La app real, con Postgres real. `extra` añade controladores/servicios de prueba. */
export async function createTestApp(
  extra: { controllers?: Type[]; providers?: Provider[]; databaseUrl?: string } = {},
): Promise<NestExpressApplication> {
  const env = testEnv({ DATABASE_URL: extra.databaseUrl ?? databaseUrl() })
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  })
    .overrideProvider(ENV)
    .useValue(env)
    .compile()

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  configureApp(app, env)
  await app.init()
  return app
}
