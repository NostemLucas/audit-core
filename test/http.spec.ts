import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/configure-app.js'
import { ENV } from '../src/platform/config/index.js'
import { testEnv } from './support/env.js'
import { DomainError } from '../src/platform/errors/index.js'
import { page } from '../src/platform/http/index.js'
import { OrganizationErrors } from '../src/modules/organizations/errors.js'
import '../src/app-errors.js'
import { Public } from '../src/platform/authz/index.js'

@Public()
@Controller('__test')
class ProbeController {
  @Get('ok')
  ok() {
    return { a: 1 }
  }

  @Get('nothing')
  nothing() {
    return undefined
  }

  @Get('page')
  list() {
    return page(['x', 'y'], { page: 2, pageSize: 2, total: 5 })
  }

  @Get('domain')
  domain() {
    throw new DomainError(OrganizationErrors.ORGANIZATION_NAME_TAKEN, { name: 'ACME' })
  }

  @Get('bad-request')
  badRequest() {
    throw new BadRequestException({ message: ['campo requerido'] })
  }

  @Get('boom')
  boom() {
    throw new Error('password=hunter2 en la cadena de conexión')
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return body
  }
}

let app: NestExpressApplication | undefined

async function boot(envOverrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const env = testEnv(envOverrides)
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProbeController] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile()
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  configureApp(app, env)
  await app.init()
  return app
}

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('HTTP: éxito', () => {
  it('envuelve la respuesta en { data }', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/ok').expect(200)
    expect(res.body).toEqual({ data: { a: 1 } })
  })

  it('una respuesta vacía es { data: null }', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/nothing').expect(200)
    expect(res.body).toEqual({ data: null })
  })

  it('un Page se envuelve como { data, meta }', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/page').expect(200)
    expect(res.body).toEqual({ data: ['x', 'y'], meta: { page: 2, pageSize: 2, total: 5, totalPages: 3 } })
  })

  it('health/live está fuera del prefijo y de la versión', async () => {
    const res = await request((await boot()).getHttpServer()).get('/health/live').expect(200)
    expect(res.body).toEqual({ data: { status: 'ok' } })
  })
})

describe('HTTP: errores', () => {
  it('un DomainError sale con el código, HTTP y mensaje del catálogo, más details', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/domain').expect(409)
    expect(res.body.error).toMatchObject({
      code: 'ORGANIZATION_NAME_TAKEN',
      message: 'Ya existe una organización con ese nombre',
      details: { name: 'ACME' },
    })
    expect(res.body.error.traceId).toBe(res.headers['x-request-id'])
  })

  it('una ruta inexistente es NOT_FOUND', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/no-existe').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('un HttpException 400 es VALIDATION_FAILED con el detalle original', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/bad-request').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toMatchObject({ message: ['campo requerido'] })
  })

  it('un JSON mal formado es VALIDATION_FAILED (400), no un 500', async () => {
    const res = await request((await boot()).getHttpServer())
      .post('/api/v1/__test/echo')
      .set('content-type', 'application/json')
      .send('{"roto":')
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('un error desconocido es INTERNAL (500) y NO filtra el mensaje', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__test/boom').expect(500)
    expect(res.body.error.code).toBe('INTERNAL')
    expect(JSON.stringify(res.body)).not.toContain('hunter2')
    expect(res.body.error).not.toHaveProperty('details')
  })

  it('el rate limit responde RATE_LIMITED (429) con el mismo formato', async () => {
    const server = (await boot({ THROTTLE_LIMIT: '2' })).getHttpServer()
    await request(server).get('/api/v1/__test/ok').expect(200)
    await request(server).get('/api/v1/__test/ok').expect(200)
    const res = await request(server).get('/api/v1/__test/ok').expect(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
  })

  it('health/live no cuenta para el rate limit', async () => {
    const server = (await boot({ THROTTLE_LIMIT: '1' })).getHttpServer()
    for (let i = 0; i < 3; i++) await request(server).get('/health/live').expect(200)
  })
})

describe('HTTP: transversales', () => {
  it('reutiliza un x-request-id válido y genera uno si falta o es inválido', async () => {
    const server = (await boot()).getHttpServer()
    const given = await request(server).get('/health/live').set('x-request-id', 'trace-abc-12345')
    expect(given.headers['x-request-id']).toBe('trace-abc-12345')

    const missing = await request(server).get('/health/live')
    expect(missing.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)

    const invalid = await request(server).get('/health/live').set('x-request-id', 'x')
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('aplica cabeceras de seguridad (helmet) y no anuncia Express', async () => {
    const res = await request((await boot()).getHttpServer()).get('/health/live')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('CORS: solo los orígenes configurados', async () => {
    const server = (await boot({ CORS_ORIGINS: 'https://app.example.com' })).getHttpServer()
    const allowed = await request(server).get('/health/live').set('origin', 'https://app.example.com')
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com')
    const denied = await request(server).get('/health/live').set('origin', 'https://evil.example.com')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })
})
