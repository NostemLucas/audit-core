import { Controller, Get, Injectable, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/configure-app.js'
import { ENV } from '../src/platform/config/index.js'
import { ContextRunner } from '../src/platform/context/context-runner.js'
import { AppLogger, LOG_DESTINATION } from '../src/platform/logging/index.js'
import { testEnv } from './support/env.js'

@Injectable()
class ProbeService {
  constructor(private readonly logger: AppLogger) {}
  work(): void {
    // Un servicio cualquiera: no sabe de HTTP ni recibe el id a mano.
    this.logger.for('ProbeService').info('Trabajo hecho', { paso: 1 })
  }
}

@Controller('__log')
class LogProbeController {
  constructor(private readonly service: ProbeService) {}

  @Get('ok')
  ok() {
    this.service.work()
    return { ok: true }
  }

  @Get('boom')
  boom() {
    throw new Error('conexión a db://usuario:CLAVE-SECRETA@host falló')
  }
}

let app: NestExpressApplication | undefined
let output: Array<Record<string, any>> = []

async function boot(envOverrides: Record<string, string> = {}) {
  output = []
  const env = testEnv({ LOG_LEVEL: 'debug', ...envOverrides })
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [LogProbeController], providers: [ProbeService] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(LOG_DESTINATION)
    .useValue({ write: (line: string) => void output.push(JSON.parse(line)) })
    .compile()
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  configureApp(app, env)
  await app.init()
  return app
}
const linesFor = (context: string) => output.filter((l) => l['context'] === context)
const access = () => linesFor('Http')

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('log de acceso HTTP (de extremo a extremo)', () => {
  it('una línea por petición, con el x-request-id como correlationId', async () => {
    const server = (await boot()).getHttpServer()
    const res = await request(server).get('/api/v1/__log/ok').set('x-request-id', 'trace-http-12345').expect(200)
    await new Promise((r) => setTimeout(r, 30)) // `close` se emite justo después de responder
    expect(access()).toHaveLength(1)
    expect(access()[0]).toMatchObject({
      level: 'info',
      msg: 'Petición HTTP',
      method: 'GET',
      path: '/api/v1/__log/ok',
      status: 200,
      correlationId: 'trace-http-12345',
    })
    expect(res.headers['x-request-id']).toBe('trace-http-12345')
  })

  it('registra lo que un interceptor no vería: una ruta inexistente y un cuerpo rechazado antes del handler', async () => {
    const server = (await boot()).getHttpServer()
    await request(server).get('/api/v1/__log/no-existe').expect(404)
    // JSON roto: lo rechaza el analizador del cuerpo ANTES de llegar al enrutador, sin pasar por ningún handler.
    await request(server).post('/api/v1/__log/ok').set('content-type', 'application/json').send('{"roto":').expect(400)
    await new Promise((r) => setTimeout(r, 30))
    const statuses = access().map((l) => `${l['status']}:${l['level']}`)
    expect(statuses).toEqual(['404:warn', '400:warn'])
  })

  it('NO registra el query string ni el valor de la cabecera Authorization', async () => {
    const server = (await boot()).getHttpServer()
    await request(server).get('/api/v1/__log/ok?token=QUERY-SECRETO').set('authorization', 'Bearer JWT-SECRETO').expect(200)
    await new Promise((r) => setTimeout(r, 30))
    const everything = JSON.stringify(output)
    expect(everything).not.toContain('QUERY-SECRETO')
    expect(everything).not.toContain('JWT-SECRETO')
  })

  it('no ensucia el log con los health checks', async () => {
    const server = (await boot()).getHttpServer()
    await request(server).get('/health/live').expect(200)
    await new Promise((r) => setTimeout(r, 30))
    expect(access()).toHaveLength(0)
  })
})

describe('el logger de aplicación no sabe de HTTP, pero hereda el contexto', () => {
  it('un servicio que loguea dentro de una petición sale con el correlationId, sin pasarlo a mano', async () => {
    const server = (await boot()).getHttpServer()
    await request(server).get('/api/v1/__log/ok').set('x-request-id', 'trace-svc-12345').expect(200)
    const [line] = linesFor('ProbeService')
    expect(line).toMatchObject({ msg: 'Trabajo hecho', paso: 1, correlationId: 'trace-svc-12345' })
    // Y sin ningún campo propio de HTTP:
    for (const httpField of ['method', 'path', 'status', 'durationMs']) expect(line).not.toHaveProperty(httpField)
  })
})

describe('errores: quién registra qué', () => {
  it('un 500 deja el error completo en el log del filtro y NO en la respuesta', async () => {
    const server = (await boot()).getHttpServer()
    const res = await request(server).get('/api/v1/__log/boom').set('x-request-id', 'trace-err-12345').expect(500)
    await new Promise((r) => setTimeout(r, 30))

    expect(JSON.stringify(res.body)).not.toContain('CLAVE-SECRETA')

    const [failure] = linesFor('ExceptionFilter')
    expect(failure).toMatchObject({ level: 'error', msg: 'Error no controlado', code: 'INTERNAL', status: 500, correlationId: 'trace-err-12345' })
    expect(failure?.['err']).toMatchObject({ type: 'Error' })
    expect(failure?.['err'].stack).toContain('boom')

    // El log de acceso registra la petición y su resultado, por separado y con el mismo correlationId.
    expect(access()[0]).toMatchObject({ level: 'error', status: 500, correlationId: 'trace-err-12345' })
  })

  it('un error de negocio (4xx) NO se registra como error: solo en debug y en el log de acceso', async () => {
    const server = (await boot({ LOG_LEVEL: 'info' })).getHttpServer()
    await request(server).get('/api/v1/__log/no-existe').expect(404)
    await new Promise((r) => setTimeout(r, 30))
    expect(linesFor('ExceptionFilter')).toHaveLength(0)
  })
})

describe('fuera de HTTP el mismo logger funciona igual (jobs, seeds, arranque)', () => {
  it('ContextRunner abre un contexto con su propio correlationId y los logs lo llevan', async () => {
    const application = await boot()
    const runner = application.get(ContextRunner)
    const logger = application.get(AppLogger).for('JobDemo')
    output.length = 0
    await runner.run('reporte-nocturno', async () => logger.info('Procesando', { lote: 3 }))
    expect(output[0]).toMatchObject({ context: 'JobDemo', msg: 'Procesando', lote: 3 })
    expect(output[0]?.['correlationId']).toMatch(/^reporte-nocturno:[0-9a-f-]{36}$/)
    for (const httpField of ['method', 'path', 'status']) expect(output[0]).not.toHaveProperty(httpField)
  })

  it('dos ejecuciones del mismo punto de entrada tienen correlationId distinto', async () => {
    const application = await boot()
    const runner = application.get(ContextRunner)
    const logger = application.get(AppLogger).for('JobDemo')
    output.length = 0
    await runner.run('job', async () => logger.info('a'))
    await runner.run('job', async () => logger.info('b'))
    expect(output[0]?.['correlationId']).not.toBe(output[1]?.['correlationId'])
  })

  it('un contexto anidado NO hereda el del padre (es otra unidad de trabajo)', async () => {
    const application = await boot()
    const runner = application.get(ContextRunner)
    const logger = application.get(AppLogger).for('JobDemo')
    output.length = 0
    await runner.run('externo', async () => {
      logger.info('fuera')
      await runner.run('interno', async () => logger.info('dentro'))
    })
    expect(output[0]?.['correlationId']).toMatch(/^externo:/)
    expect(output[1]?.['correlationId']).toMatch(/^interno:/)
  })

  it('sin ningún contexto (arranque) se puede loguear, sin correlationId', async () => {
    const application = await boot()
    output.length = 0
    application.get(AppLogger).for('Bootstrap').info('Arrancando')
    expect(output[0]).toMatchObject({ context: 'Bootstrap', msg: 'Arrancando' })
    expect(output[0]).not.toHaveProperty('correlationId')
  })
})
