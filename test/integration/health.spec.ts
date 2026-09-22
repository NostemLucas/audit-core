import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { UNREACHABLE_DATABASE_URL } from '../support/env.js'
import { FakeFileStorage } from '../../src/platform/nextcloud/index.js'
import { createTestApp } from './support/app.js'

let app: NestExpressApplication | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('/health', () => {
  it('ready: 200 con la base de datos respondiendo; Nextcloud inalcanzable no lo bloquea (informa "down")', async () => {
    app = await createTestApp()
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200)
    expect(res.body).toEqual({ data: { status: 'ok', checks: { database: 'up', nextcloud: 'down' } } })
  })

  it('ready: con Nextcloud respondiendo, lo informa "up"', async () => {
    app = await createTestApp({ fileStorage: new FakeFileStorage() })
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200)
    expect(res.body.data.checks).toEqual({ database: 'up', nextcloud: 'up' })
  })

  it('ready: 503 SERVICE_UNAVAILABLE si la base no responde; live sigue en 200', async () => {
    app = await createTestApp({ databaseUrl: UNREACHABLE_DATABASE_URL })
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(503)
    expect(ready.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { check: 'database' } })
    expect(JSON.stringify(ready.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/)
    await request(app.getHttpServer()).get('/health/live').expect(200)
  })
})
