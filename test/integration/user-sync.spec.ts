import { createMongoAbility } from '@casl/ability'
import { unpackRules } from '@casl/ability/extra'
import { Controller, Inject, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Can } from '../../src/platform/authz/index.js'
import { defineAbilityFor, ACTIONS, SUBJECTS } from '../../src/platform/authz/index.js'
import { DB, type Db } from '../../src/platform/db/index.js'
import { createTestIssuer } from '../support/identity.js'
import { createTestApp } from './support/app.js'
import { resetDb } from './support/db.js'

@Controller('__sync')
class SyncProbeController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Crea una organización a través de la petición autenticada: comprueba token → contexto → sellos de la BD. */
  @Post('org')
  @Can('create', 'Organization')
  createOrg() {
    return this.db.organization.create({
      data: { name: `org-${Math.random().toString(36).slice(2)}` },
      select: { createdById: true, updatedById: true },
    })
  }
}

let app: NestExpressApplication
let db: Db
let issuer: Awaited<ReturnType<typeof createTestIssuer>>
let logs: Array<Record<string, any>> = []

beforeAll(async () => {
  issuer = await createTestIssuer()
  app = await createTestApp({
    controllers: [SyncProbeController],
    jwtKeys: issuer.keys,
    logSink: (l) => void logs.push(l as Record<string, any>),
  })
  db = app.get<Db>(DB)
})
afterAll(() => app.close())
beforeEach(async () => {
  logs = []
  await resetDb(db)
})

/**
 * Un login de prueba: `await login(...)` da la respuesta, y `login(...).expect(200)` la comprueba, como supertest.
 * (Firmar el token es asíncrono; y `await` sobre el objeto de supertest lo aplana a una respuesta, por eso `.expect` se
 * aplica dentro, antes de resolver.)
 */
function login(options: Parameters<typeof issuer.sign>[0] = {}) {
  const token = issuer.sign(options)
  const send = async (status?: number) => {
    const call = request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('authorization', `Bearer ${await token}`)
    return status === undefined ? call : call.expect(status)
  }
  return {
    expect: (status: number) => send(status),
    then: (onFulfilled: (response: request.Response) => unknown, onRejected?: (reason: unknown) => unknown) =>
      send().then(onFulfilled as never, onRejected),
  }
}
const users = () => db.user.findMany({ orderBy: { createdAt: 'asc' } })

describe('primer login: se crea el usuario desde el token', () => {
  it('guarda lo del proveedor: email en minúsculas, username TAL CUAL, name y roles desde los grupos', async () => {
    const res = await login({
      subject: 'sub-1',
      claims: {
        email: 'Ana.Perez@Ejemplo.com',
        preferred_username: 'Ana.PEREZ',
        name: 'Ana Pérez',
        groups: ['auditor', 'gerente'],
      },
    }).expect(200)
    const [row] = await users()
    expect(row).toMatchObject({
      authentikId: 'sub-1',
      email: 'ana.perez@ejemplo.com',
      username: 'Ana.PEREZ',
      name: 'Ana Pérez',
      roles: ['GERENTE', 'AUDITOR'],
    })
    expect(res.body.data.user).toMatchObject({ id: row!.id, username: 'Ana.PEREZ', roles: ['GERENTE', 'AUDITOR'] })
  })

  it('sin `name` en el token usa el username', async () => {
    await login({ claims: { name: undefined } }).expect(200)
    expect((await users())[0]?.name).toBe('Ana.Perez')
  })

  it('un usuario sin grupos reconocidos existe, sin roles, y puede ver su perfil', async () => {
    const res = await login({ claims: { groups: ['ventas'] } }).expect(200)
    expect(res.body.data.user.roles).toEqual([])
    expect((await users())[0]?.roles).toEqual([])
    const advertencia = logs.find((l) => l['msg']?.startsWith('Usuario sin ningún rol reconocido'))
    expect(advertencia).toMatchObject({ level: 'warn', groups: ['ventas'] })
  })
})

describe('claims que faltan: se rechaza, NO se inventa', () => {
  it('sin preferred_username → 401 TOKEN_CLAIMS_MISSING y no se crea el usuario', async () => {
    const res = await login({ claims: { preferred_username: undefined } }).expect(401)
    expect(res.body.error).toMatchObject({ code: 'TOKEN_CLAIMS_MISSING', details: { missing: ['preferred_username'] } })
    expect(await db.user.count()).toBe(0)
  })

  it('sin email → 401 y no se crea', async () => {
    const res = await login({ claims: { email: undefined } }).expect(401)
    expect(res.body.error.details.missing).toEqual(['email'])
    expect(await db.user.count()).toBe(0)
  })
})

describe('logins siguientes: solo se escribe si algo cambió', () => {
  it('mismos claims → una sola fila y SIN escritura (updatedAt no se mueve)', async () => {
    await login().expect(200)
    const before = (await users())[0]!
    await new Promise((r) => setTimeout(r, 20))
    await login().expect(200)
    await login().expect(200)
    const after = await users()
    expect(after).toHaveLength(1)
    expect(after[0]?.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('el orden de los grupos no provoca una escritura (roles en orden fijo)', async () => {
    await login({ claims: { groups: ['auditor', 'admin'] } }).expect(200)
    const before = (await users())[0]!
    await new Promise((r) => setTimeout(r, 20))
    await login({ claims: { groups: ['admin', 'auditor'] } }).expect(200)
    expect((await users())[0]?.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('si cambian nombre, email o grupos en Authentik, se actualiza', async () => {
    await login({ claims: { name: 'Ana', groups: ['auditor'] } }).expect(200)
    await login({ claims: { name: 'Ana María', email: 'ana.maria@ejemplo.com', groups: ['gerente'] } }).expect(200)
    const rows = await users()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Ana María', email: 'ana.maria@ejemplo.com', roles: ['GERENTE'] })
  })
})

describe('el sistema nunca se queda sin ADMIN por un cambio en Authentik', () => {
  it('se conserva el rol del ÚNICO administrador y se avisa', async () => {
    await login({
      subject: 'sub-admin',
      claims: { email: 'a@x.com', preferred_username: 'root', groups: ['admin'] },
    }).expect(200)
    await login({
      subject: 'sub-admin',
      claims: { email: 'a@x.com', preferred_username: 'root', groups: ['auditor'] },
    }).expect(200)
    expect((await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-admin' } })).roles).toEqual([
      'ADMIN',
      'AUDITOR',
    ])
    expect(
      logs.some(
        (l) => l['level'] === 'warn' && l['msg'] === 'Se conserva ADMIN: es el único administrador del sistema',
      ),
    ).toBe(true)
  })

  it('si hay OTRO administrador, sí se le quita', async () => {
    await login({
      subject: 'sub-admin-1',
      claims: { email: 'a1@x.com', preferred_username: 'root1', groups: ['admin'] },
    }).expect(200)
    await login({
      subject: 'sub-admin-2',
      claims: { email: 'a2@x.com', preferred_username: 'root2', groups: ['admin'] },
    }).expect(200)
    await login({
      subject: 'sub-admin-1',
      claims: { email: 'a1@x.com', preferred_username: 'root1', groups: ['auditor'] },
    }).expect(200)
    expect((await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-admin-1' } })).roles).toEqual(['AUDITOR'])
  })
})

describe('concurrencia e identidad', () => {
  // Humo, no prueba de la carrera: las peticiones se serializan antes de la BD y rara vez colisionan. El reintento se
  // prueba de forma determinista en `retry-identity-conflict.spec.ts` (una mutación sin reintento no lo rompía aquí).
  it('humo: 8 primeros logins simultáneos del mismo usuario → una sola fila y todos responden 200', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        login({ subject: 'sub-race', claims: { email: 'race@x.com', preferred_username: 'race' } }),
      ),
    )
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200))
    expect(await db.user.count()).toBe(1)
  })

  it('OTRA cuenta (otro sub) con el mismo email → 409 USER_IDENTITY_CONFLICT; no se enlaza por email', async () => {
    await login({ subject: 'sub-original', claims: { email: 'dup@x.com', preferred_username: 'original' } }).expect(200)
    const res = await login({ subject: 'sub-otra', claims: { email: 'dup@x.com', preferred_username: 'otra' } }).expect(
      409,
    )
    expect(res.body.error.code).toBe('USER_IDENTITY_CONFLICT')
    expect(await db.user.count()).toBe(1) // ni se creó una segunda ni se secuestró la primera
    expect((await users())[0]?.authentikId).toBe('sub-original')
  })

  it('OTRA cuenta con el mismo username → 409', async () => {
    await login({ subject: 'sub-1', claims: { email: 'uno@x.com', preferred_username: 'mismo' } }).expect(200)
    await login({ subject: 'sub-2', claims: { email: 'dos@x.com', preferred_username: 'mismo' } }).expect(409)
  })
})

describe('GET /profile: el contrato con el frontend', () => {
  it('las reglas empaquetadas reconstruyen exactamente los permisos del backend', async () => {
    const res = await login({ claims: { groups: ['auditor', 'gerente'] } }).expect(200)
    const frontend = createMongoAbility(unpackRules(res.body.data.abilities) as never)
    const backend = defineAbilityFor(['GERENTE', 'AUDITOR'])
    for (const action of ACTIONS)
      for (const subject of SUBJECTS)
        expect(frontend.can(action, subject), `${action} ${subject}`).toBe(backend.can(action, subject))
  })

  it('sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/profile').expect(401)
  })
})

describe('de extremo a extremo: token → contexto → sellos de la base de datos', () => {
  it('lo que crea una petición autenticada queda sellado con SU usuario', async () => {
    const token = await issuer.sign({
      subject: 'sub-gerente',
      claims: { email: 'g@x.com', preferred_username: 'gerente', groups: ['gerente'] },
    })
    const res = await request(app.getHttpServer())
      .post('/api/v1/__sync/org')
      .set('authorization', `Bearer ${token}`)
      .expect(201)
    const user = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-gerente' } })
    expect(res.body.data).toEqual({ createdById: user.id, updatedById: user.id })
  })

  it('un AUDITOR no puede crear organizaciones (403), y no queda ninguna escritura', async () => {
    const token = await issuer.sign({ claims: { groups: ['auditor'] } })
    await request(app.getHttpServer()).post('/api/v1/__sync/org').set('authorization', `Bearer ${token}`).expect(403)
    expect(await db.organization.count()).toBe(0)
  })
})
