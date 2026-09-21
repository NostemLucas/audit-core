import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/configure-app.js'
import { ENV } from '../src/platform/config/index.js'
import { testEnv } from './support/env.js'

/** El OpenAPI de la aplicación REAL (no de un controlador de ejemplo): un tipo que no se pueda documentar rompe aquí. */
let app: NestExpressApplication
let doc: OpenAPIObject

beforeAll(async () => {
  const env = testEnv()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile()
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  configureApp(app, env)
  await app.init()
  doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('audit-core').setVersion('1').build())
})
afterAll(() => app.close())

type Operation = { responses?: Record<string, { content?: Record<string, { schema?: any }> }>; requestBody?: any }
const operations = (): Array<[string, Operation]> =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    (['get', 'post', 'patch', 'put', 'delete'] as const).flatMap((method) => {
      const op = (item as Record<string, Operation | undefined>)[method]
      return op ? [[`${method.toUpperCase()} ${path}`, op] as [string, Operation]] : []
    }),
  )

describe('OpenAPI de la aplicación', () => {
  it('documenta las rutas de negocio (organizaciones, escalas, plantillas y controles)', () => {
    const routes = operations().map(([name]) => name)
    for (const route of [
      'GET /api/v1/organizations',
      'POST /api/v1/audits',
      'GET /api/v1/audits/{id}',
      'POST /api/v1/audits/{auditId}/scope-items',
      'POST /api/v1/scales',
      'POST /api/v1/scales/{id}/levels',
      'GET /api/v1/templates',
      'POST /api/v1/templates/import',
      'GET /api/v1/templates/{id}/export',
      'GET /api/v1/templates/{templateId}/suggested-findings',
      'GET /api/v1/templates/{templateId}/suggested-findings/export',
      'POST /api/v1/templates/{templateId}/suggested-findings/import',
      'POST /api/v1/templates/{id}/clone',
      'POST /api/v1/templates/{templateId}/controls/{controlId}/move',
    ]) {
      expect(routes, route).toContain(route)
    }
  })

  it('las fechas previstas de una auditoría se documentan como texto de fecha (date), sin hora', () => {
    const audit = doc.paths['/api/v1/audits/{id}']?.get?.responses?.['200'] as {
      content: Record<string, { schema: any }>
    }
    const data = audit.content['application/json']!.schema.properties.data.properties
    expect(data.plannedStart).toMatchObject({ format: 'date' })
    expect(data.closedAt).toBeDefined()
  })

  it('las fechas se documentan como texto date-time y los puntajes como número (no como objetos internos)', () => {
    const scale = doc.paths['/api/v1/scales/{id}']?.get?.responses?.['200'] as {
      content: Record<string, { schema: any }>
    }
    const data = scale.content['application/json']!.schema.properties.data.properties
    expect(data.createdAt).toMatchObject({ type: 'string', format: 'date-time' })
    expect(data.levels.items.properties.value).toMatchObject({ type: 'number' })
  })

  it('la importación es multipart con un archivo binario y la exportación produce un .xlsx', () => {
    const importBody = (doc.paths['/api/v1/templates/import']?.post as Operation).requestBody
    expect(importBody.content['multipart/form-data'].schema.properties.file).toMatchObject({
      type: 'string',
      format: 'binary',
    })
    const matrixBody = (doc.paths['/api/v1/templates/{templateId}/suggested-findings/import']?.post as Operation)
      .requestBody
    expect(matrixBody.content['multipart/form-data'].schema.properties.file).toMatchObject({
      type: 'string',
      format: 'binary',
    })
    const exported = (doc.paths['/api/v1/templates/{id}/export']?.get as Operation).responses!['200']!
    expect(Object.keys(exported.content!)).toEqual([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ])
  })

  it('ninguna respuesta de éxito documentada trae un esquema vacío o sin representar', () => {
    for (const [name, op] of operations()) {
      const ok = Object.entries(op.responses ?? {}).filter(([status]) => status.startsWith('2') && status !== '204')
      for (const [, response] of ok) {
        const schemas = Object.values(response.content ?? {}).map((c) => c.schema)
        for (const schema of schemas) {
          expect(schema, name).toBeDefined()
          expect(JSON.stringify(schema), name).not.toMatch(/unrepresentable|\\{\\}/i)
        }
      }
    }
  })
})
