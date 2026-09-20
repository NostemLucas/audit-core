import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/configure-app.js'
import { ENV } from '../src/platform/config/index.js'
import { testEnv } from './support/env.js'
import { Responds, page } from '../src/platform/http/index.js'
import { Public } from '../src/platform/authz/index.js'

// Esquemas de ejemplo: una sola definición da validación, tipo y documentación.
const CreateInput = z.object({ name: z.string().min(3).max(20), tags: z.array(z.string()).default([]) })
const ListQuery = z.object({ page: z.coerce.number().int().min(1).default(1), active: z.stringbool().optional() })
const ItemView = z.object({ id: z.uuid(), name: z.string() })

const ID = '0199c0de-0000-7000-8000-000000000001'
type CreateInputT = z.infer<typeof CreateInput>
type ListQueryT = z.infer<typeof ListQuery>

@Public()
@Controller('__items')
class ItemsController {
  @Post()
  create(@Body({ schema: CreateInput }) body: CreateInputT) {
    return body // devuelve lo que la validación dejó pasar (sin claves desconocidas, con defaults)
  }

  @Get('query')
  query(@Query({ schema: ListQuery }) q: ListQueryT) {
    return { page: q.page, pageType: typeof q.page, active: q.active }
  }

  @Get('by-id/:id')
  byId(@Param('id', { schema: z.uuid() }) id: string) {
    return { id }
  }

  @Responds(ItemView)
  @Get('one')
  one() {
    // Campos que NO están en el esquema de salida: no deben llegar al cliente.
    return { id: ID, name: 'Uno', createdById: 'secreto', internal: { x: 1 } }
  }

  @Responds(ItemView, { kind: 'list' })
  @Get('many')
  many() {
    return [{ id: ID, name: 'A', createdById: 's' }, { id: ID, name: 'B', createdById: 's' }]
  }

  @Responds(ItemView, { kind: 'page' })
  @Get('paged')
  paged() {
    return page([{ id: ID, name: 'A', createdById: 's' }], { page: 1, pageSize: 10, total: 1 })
  }

  @Responds(ItemView)
  @Get('broken')
  broken() {
    return { id: 'no-es-uuid', name: 'Roto' } // viola su propio esquema de salida: bug nuestro
  }
}

let app: NestExpressApplication | undefined

async function boot(): Promise<NestExpressApplication> {
  const env = testEnv()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ItemsController] })
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

describe('validación de entrada (Standard Schema nativo de Nest 12)', () => {
  it('acepta, recorta claves desconocidas y aplica defaults', async () => {
    const res = await request((await boot()).getHttpServer())
      .post('/api/v1/__items')
      .send({ name: 'Auditoría', hack: true })
      .expect(201)
    expect(res.body).toEqual({ data: { name: 'Auditoría', tags: [] } })
  })

  it('rechaza con VALIDATION_FAILED y details.issues [{ path, message }]', async () => {
    const res = await request((await boot()).getHttpServer())
      .post('/api/v1/__items')
      .send({ name: 'ab', tags: [1] })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    const paths = res.body.error.details.issues.map((i: { path: string }) => i.path).sort()
    expect(paths).toEqual(['name', 'tags.0'])
    expect(res.body.error.details.issues[0]).toEqual({ path: expect.any(String), message: expect.any(String) })
  })

  it('transforma la query (coerción a número, default, stringbool)', async () => {
    const server = (await boot()).getHttpServer()
    const res = await request(server).get('/api/v1/__items/query?page=3&active=true').expect(200)
    expect(res.body.data).toEqual({ page: 3, pageType: 'number', active: true })
    const defaults = await request(server).get('/api/v1/__items/query').expect(200)
    expect(defaults.body.data.page).toBe(1)
  })

  it('rechaza una query inválida', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__items/query?page=0').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.issues[0].path).toBe('page')
  })

  it('valida un parámetro de ruta (uuid)', async () => {
    const server = (await boot()).getHttpServer()
    await request(server).get(`/api/v1/__items/by-id/${ID}`).expect(200)
    const res = await request(server).get('/api/v1/__items/by-id/no-es-uuid').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('serialización de salida (nativa) + envelope', () => {
  it('recorta los campos que no están en el esquema de salida', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__items/one').expect(200)
    expect(res.body).toEqual({ data: { id: ID, name: 'Uno' } })
    expect(JSON.stringify(res.body)).not.toContain('secreto')
  })

  it('serializa cada elemento de un array', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__items/many').expect(200)
    expect(res.body.data).toEqual([{ id: ID, name: 'A' }, { id: ID, name: 'B' }])
  })

  it('un Page se serializa ítem por ítem y conserva meta', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__items/paged').expect(200)
    expect(res.body).toEqual({ data: [{ id: ID, name: 'A' }], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } })
  })

  it('una respuesta que viola su propio esquema es INTERNAL (500) y no filtra el detalle', async () => {
    const res = await request((await boot()).getHttpServer()).get('/api/v1/__items/broken').expect(500)
    expect(res.body.error.code).toBe('INTERNAL')
    expect(JSON.stringify(res.body)).not.toMatch(/Serialization|uuid/i)
  })
})

describe('OpenAPI generado desde los mismos esquemas (@nestjs/swagger 12)', () => {
  it('documenta el cuerpo, la query y la respuesta sin decoradores extra', async () => {
    const doc = SwaggerModule.createDocument(await boot(), new DocumentBuilder().setTitle('t').setVersion('1').build())
    const create = doc.paths['/api/v1/__items']?.post
    const body = create?.requestBody as { content: Record<string, { schema: any }> } | undefined
    const schema = body?.content['application/json']?.schema
    expect(JSON.stringify(schema)).toContain('minLength')
    expect(JSON.stringify(schema)).toContain('"name"')

    const query = doc.paths['/api/v1/__items/query']?.get?.parameters as Array<{ name: string; in: string }>
    expect(query.map((p) => p.name)).toEqual(expect.arrayContaining(['page', 'active']))

    const one = doc.paths['/api/v1/__items/one']?.get?.responses?.['200'] as { content: Record<string, { schema: any }> }
    const oneSchema = one.content['application/json']!.schema
    expect(oneSchema.properties.data.properties).toHaveProperty('name') // documenta el envelope { data: ítem }

    const paged = doc.paths['/api/v1/__items/paged']?.get?.responses?.['200'] as { content: Record<string, { schema: any }> }
    const pagedSchema = paged.content['application/json']!.schema
    expect(pagedSchema.properties.data.type).toBe('array')
    expect(pagedSchema.properties.meta.properties).toHaveProperty('totalPages')
  })
})
