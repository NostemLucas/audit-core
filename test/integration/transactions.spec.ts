import { Controller, Get, Inject, Injectable, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ClsService } from 'nestjs-cls'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DB, InjectTx, Transactional, type Db, type Tx } from '../../src/platform/db/index.js'
import { DomainError } from '../../src/platform/errors/index.js'
import { createTestApp } from './support/app.js'
import { resetDb } from './support/db.js'
import { Public } from '../../src/platform/authz/index.js'

@Injectable()
class DemoService {
  constructor(@InjectTx() private readonly tx: Tx) {}

  @Transactional()
  async orgWithScale(name: string, failAfter = false): Promise<string> {
    const org = await this.tx.organization.create({ data: { name } })
    await this.tx.scale.create({ data: { name: `escala-${name}`, dimension: 'MATURITY' } })
    if (failAfter) throw new Error('boom')
    return org.id
  }

  /** Sin @Transactional: cada escritura se confirma sola (autocommit). */
  async orgThenFail(name: string): Promise<void> {
    await this.tx.organization.create({ data: { name } })
    throw new Error('boom')
  }

  @Transactional()
  async nested(name: string, failOuter: boolean): Promise<void> {
    await this.orgWithScale(name) // se une a la transacción externa
    if (failOuter) throw new Error('outer')
  }
}

@Public()
@Controller('__db')
class DbProbeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cls: ClsService,
    private readonly demo: DemoService,
  ) {}

  @Post('org')
  create() {
    return this.db.organization.create({ data: { name: 'HTTP-ACME' }, select: { name: true } })
  }

  /** @Transactional por HTTP: comprueba que el contexto que abre `platform/http` sirve a las transacciones. */
  @Post('tx-fail')
  async txFail() {
    await this.demo.orgWithScale('HTTP-TX', true)
  }

  @Post('tx-ok')
  async txOk() {
    await this.demo.orgWithScale('HTTP-TX-OK')
  }

  @Get('correlation')
  correlation() {
    return { correlationId: this.cls.get('correlationId') }
  }
}

let app: NestExpressApplication
let db: Db
let demo: DemoService
let cls: ClsService

beforeAll(async () => {
  app = await createTestApp({ controllers: [DbProbeController], providers: [DemoService] })
  db = app.get<Db>(DB)
  demo = app.get(DemoService)
  cls = app.get(ClsService)
})
afterAll(() => app.close())
beforeEach(() => resetDb(db))

const count = () => db.organization.count()
const inContext = <T>(work: () => Promise<T>) => cls.run(work)

describe('transacciones declarativas (@Transactional + @InjectTx)', () => {
  it('confirma todo cuando el método termina bien', async () => {
    await inContext(() => demo.orgWithScale('OK'))
    expect(await count()).toBe(1)
    expect(await db.scale.count()).toBe(1)
  })

  it('revierte TODO si el método lanza (ni organización ni escala)', async () => {
    await expect(inContext(() => demo.orgWithScale('ROLLBACK', true))).rejects.toThrow('boom')
    expect(await count()).toBe(0)
    expect(await db.scale.count()).toBe(0)
  })

  it('sin @Transactional no hay rollback: cada escritura se confirma sola', async () => {
    await expect(inContext(() => demo.orgThenFail('AUTOCOMMIT'))).rejects.toThrow('boom')
    expect(await count()).toBe(1)
  })

  it('un método transaccional dentro de otro se une a la transacción externa', async () => {
    await expect(inContext(() => demo.nested('NESTED', true))).rejects.toThrow('outer')
    expect(await count()).toBe(0) // la interna no se confirmó por su cuenta
    await inContext(() => demo.nested('NESTED-OK', false))
    expect(await count()).toBe(1)
  })

  it('un error de unicidad DENTRO de la transacción sale traducido y deja la BD intacta', async () => {
    await db.organization.create({ data: { name: 'DUP' } })
    const error = await inContext(() => demo.orgWithScale('DUP')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'ORGANIZATION_NAME_TAKEN' })
    expect(await db.scale.count()).toBe(0)
  })

  it('carrera: dos transacciones simultáneas con el mismo nombre → una gana, la otra recibe el error del catálogo', async () => {
    const results = await Promise.allSettled([
      inContext(() => demo.orgWithScale('RACE')),
      inContext(() => demo.orgWithScale('RACE')),
    ])
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ code: 'ORGANIZATION_NAME_TAKEN' })
    expect(await count()).toBe(1)
    expect(await db.scale.count()).toBe(1)
  })
})

describe('de extremo a extremo por HTTP', () => {
  it('un duplicado llega al cliente como 409 con el código del catálogo y el envelope de error', async () => {
    const server = app.getHttpServer()
    await request(server).post('/api/v1/__db/org').expect(201)
    const res = await request(server).post('/api/v1/__db/org').expect(409)
    expect(res.body.error).toMatchObject({
      code: 'ORGANIZATION_NAME_TAKEN',
      message: 'Ya existe una organización con ese nombre',
    })
    expect(res.body.error.traceId).toBe(res.headers['x-request-id'])
    expect(JSON.stringify(res.body)).not.toContain('organizations_name_key')
  })

  it('el x-request-id de la petición queda como correlationId en el contexto ambiental (CLS)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__db/correlation')
      .set('x-request-id', 'trace-cls-12345')
      .expect(200)
    expect(res.body.data.correlationId).toBe('trace-cls-12345')
  })

  it('@Transactional funciona dentro de una petición HTTP: un fallo revierte TODO, un éxito confirma todo', async () => {
    const server = app.getHttpServer()
    await request(server).post('/api/v1/__db/tx-fail').expect(500)
    expect(await count()).toBe(0)
    expect(await db.scale.count()).toBe(0)
    await request(server).post('/api/v1/__db/tx-ok').expect(201)
    expect(await count()).toBe(1)
    expect(await db.scale.count()).toBe(1)
  })
})
