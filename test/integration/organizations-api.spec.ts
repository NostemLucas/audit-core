import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { listRoutes } from '../../src/platform/authz/index.js'
import { useTestApi, type TestRole } from './support/api.js'
import { createAuditFixture } from './support/db.js'

const BASE = '/api/v1/organizations'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const api = t.api
const as = t.as
const db = t.db

async function create(name: string, role: TestRole = 'manager') {
  return api()
    .post(BASE)
    .set('authorization', await as(role))
    .send({ name })
}

describe('permisos', () => {
  it('sin token: 401', async () => {
    await api().get(BASE).expect(401)
  })

  it('un auditor no administra organizaciones: 403 en cada operación (lo decide la política, no el endpoint)', async () => {
    const org = (await create('ACME')).body.data
    const auth = await as('auditor')
    await api().get(BASE).set('authorization', auth).expect(403)
    await api().get(`${BASE}/${org.id}`).set('authorization', auth).expect(403)
    await api().post(BASE).set('authorization', auth).send({ name: 'X' }).expect(403)
    await api().patch(`${BASE}/${org.id}`).set('authorization', auth).send({ name: 'X' }).expect(403)
    await api().post(`${BASE}/${org.id}/deactivate`).set('authorization', auth).expect(403)
    await api().delete(`${BASE}/${org.id}`).set('authorization', auth).expect(403)
    expect(await db.organization.count()).toBe(1)
  })

  it('cada endpoint declara la acción que le corresponde (los roles actuales no permiten observarlo por HTTP)', () => {
    const declared = listRoutes(t.app().get(DiscoveryService), t.app().get(MetadataScanner), t.app().get(Reflector))
      .filter((route) => route.handler.startsWith('OrganizationsController.'))
      .map((route) => {
        const access = route.access
        const can = access?.kind === 'can' ? `${access.action} ${access.subject}` : access?.kind
        return `${route.method} ${route.path} → ${can}`
      })
      .sort()
    expect(declared).toEqual(
      [
        'GET /organizations → read Organization',
        'GET /organizations/:id → read Organization',
        'POST /organizations → create Organization',
        'PATCH /organizations/:id → update Organization',
        'POST /organizations/:id/activate → update Organization',
        'POST /organizations/:id/deactivate → update Organization',
        'DELETE /organizations/:id → delete Organization',
      ].sort(),
    )
  })

  it('gerente y admin pueden crear', async () => {
    await create('Una', 'manager').then((r) => expect(r.status).toBe(201))
    await create('Otra', 'admin').then((r) => expect(r.status).toBe(201))
  })
})

describe('crear', () => {
  it('devuelve 201 y solo la vista pública (sin sellos internos)', async () => {
    const res = await create('  Banco Ejemplo  ')
    expect(res.status).toBe(201)
    expect(Object.keys(res.body.data).sort()).toEqual(['createdAt', 'id', 'isActive', 'name', 'updatedAt'])
    expect(res.body.data).toMatchObject({ name: 'Banco Ejemplo', isActive: true })
  })

  it('sella quién la creó (createdById es el usuario del token)', async () => {
    const res = await create('ACME')
    const row = await db.organization.findUniqueOrThrow({ where: { id: res.body.data.id } })
    const user = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(row.createdById).toBe(user.id)
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['demasiado largo', 'x'.repeat(201)],
  ])('nombre %s: 400 VALIDATION_FAILED', async (_caso, name) => {
    const res = await create(name)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(await db.organization.count()).toBe(0)
  })

  it('un campo que no existe se ignora (no llega a la BD): no se puede fijar isActive al crear', async () => {
    const res = await api()
      .post(BASE)
      .set('authorization', await as('manager'))
      .send({ name: 'ACME', isActive: false, address: 'Calle 1' })
    expect(res.status).toBe(201)
    expect(res.body.data.isActive).toBe(true)
  })

  it('nombre repetido: 409 ORGANIZATION_NAME_TAKEN', async () => {
    await create('ACME')
    const res = await create('ACME')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ORGANIZATION_NAME_TAKEN')
  })

  it('el nombre es único sin distinguir mayúsculas: "ACME" y "acme" son el mismo auditado', async () => {
    await create('ACME')
    const res = await create('acme')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ORGANIZATION_NAME_TAKEN')
    expect(await db.organization.count()).toBe(1)
  })

  it('dos altas simultáneas con el mismo nombre: una gana, la otra es 409 (nunca 500)', async () => {
    const results = await Promise.all([create('Carrera'), create('Carrera'), create('Carrera')])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(await db.organization.count()).toBe(1)
  })
})

describe('listar', () => {
  beforeEach(async () => {
    for (const name of ['Delta', 'alfa', 'Charlie', 'Bravo']) await create(name)
  })

  it('ordena por nombre y pagina con meta', async () => {
    const auth = await as('manager')
    const res = await api().get(BASE).query({ pageSize: 3 }).set('authorization', auth).expect(200)
    expect(res.body.data.map((o: { name: string }) => o.name)).toEqual(['alfa', 'Bravo', 'Charlie'])
    expect(res.body.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 })

    const second = await api().get(BASE).query({ pageSize: 3, page: 2 }).set('authorization', auth).expect(200)
    expect(second.body.data.map((o: { name: string }) => o.name)).toEqual(['Delta'])
  })

  it('busca por nombre sin distinguir mayúsculas', async () => {
    const res = await api()
      .get(BASE)
      .query({ q: 'ALF' })
      .set('authorization', await as('manager'))
      .expect(200)
    expect(res.body.data.map((o: { name: string }) => o.name)).toEqual(['alfa'])
    expect(res.body.meta.total).toBe(1)
  })

  it('active=true entrega solo las elegibles (lo que pide un selector); sin filtro, todas', async () => {
    const auth = await as('manager')
    const bravo = await db.organization.findFirstOrThrow({ where: { name: 'Bravo' } })
    await api().post(`${BASE}/${bravo.id}/deactivate`).set('authorization', auth).expect(200)

    const active = await api().get(BASE).query({ active: 'true' }).set('authorization', auth).expect(200)
    expect(active.body.data.map((o: { name: string }) => o.name)).not.toContain('Bravo')
    expect(active.body.meta.total).toBe(3)

    const inactive = await api().get(BASE).query({ active: 'false' }).set('authorization', auth).expect(200)
    expect(inactive.body.data.map((o: { name: string }) => o.name)).toEqual(['Bravo'])

    const all = await api().get(BASE).set('authorization', auth).expect(200)
    expect(all.body.meta.total).toBe(4)
  })

  it.each([
    ['page=0', { page: 0 }],
    ['pageSize=101', { pageSize: 101 }],
    ['active=quizás', { active: 'quizás' }],
  ])('parámetro inválido (%s): 400', async (_caso, query) => {
    await api()
      .get(BASE)
      .query(query)
      .set('authorization', await as('manager'))
      .expect(400)
  })

  it('una página fuera de rango devuelve lista vacía con el total real', async () => {
    const res = await api()
      .get(BASE)
      .query({ page: 9 })
      .set('authorization', await as('manager'))
      .expect(200)
    expect(res.body.data).toEqual([])
    expect(res.body.meta.total).toBe(4)
  })
})

describe('ver, renombrar y borrar', () => {
  it('ver: 200; id inexistente 404 ORGANIZATION_NOT_FOUND; id mal formado 400', async () => {
    const auth = await as('manager')
    const org = (await create('ACME')).body.data
    const ok = await api().get(`${BASE}/${org.id}`).set('authorization', auth).expect(200)
    expect(ok.body.data.name).toBe('ACME')

    const missing = await api().get(`${BASE}/${UNKNOWN_ID}`).set('authorization', auth)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('ORGANIZATION_NOT_FOUND')

    await api().get(`${BASE}/no-es-uuid`).set('authorization', auth).expect(400)
  })

  it('renombrar: cambia el nombre y deja el resto; sella updatedById', async () => {
    const org = (await create('ACME')).body.data
    const res = await api()
      .patch(`${BASE}/${org.id}`)
      .set('authorization', await as('admin'))
      .send({ name: 'ACME S.A.' })
      .expect(200)
    expect(res.body.data).toMatchObject({ id: org.id, name: 'ACME S.A.', isActive: true })
    const row = await db.organization.findUniqueOrThrow({ where: { id: org.id } })
    const admin = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-admin' } })
    expect(row.updatedById).toBe(admin.id)
  })

  it('renombrar a un nombre ya usado: 409; a uno inexistente: 404; con isActive en el cuerpo: se ignora', async () => {
    const auth = await as('manager')
    const a = (await create('A')).body.data
    await create('B')
    const taken = await api().patch(`${BASE}/${a.id}`).set('authorization', auth).send({ name: 'B' })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('ORGANIZATION_NAME_TAKEN')

    await api().patch(`${BASE}/${UNKNOWN_ID}`).set('authorization', auth).send({ name: 'Z' }).expect(404)

    const ignored = await api()
      .patch(`${BASE}/${a.id}`)
      .set('authorization', auth)
      .send({ name: 'A2', isActive: false })
      .expect(200)
    expect(ignored.body.data.isActive).toBe(true)
  })

  it('borrar una sin auditorías: 204 y desaparece; repetir: 404', async () => {
    const auth = await as('manager')
    const org = (await create('ACME')).body.data
    await api().delete(`${BASE}/${org.id}`).set('authorization', auth).expect(204)
    expect(await db.organization.count()).toBe(0)
    const again = await api().delete(`${BASE}/${org.id}`).set('authorization', auth)
    expect(again.status).toBe(404)
    expect(again.body.error.code).toBe('ORGANIZATION_NOT_FOUND')
  })

  it('borrar una con auditorías: 409 ORGANIZATION_IN_USE y no se pierde nada; desactivarla sí se puede', async () => {
    const auth = await as('manager')
    const org = (await create('ACME')).body.data
    await createAuditFixture(db, org.id)

    const res = await api().delete(`${BASE}/${org.id}`).set('authorization', auth)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ORGANIZATION_IN_USE')
    expect(await db.organization.count()).toBe(1)
    expect(await db.audit.count()).toBe(1)

    await api().post(`${BASE}/${org.id}/deactivate`).set('authorization', auth).expect(200)
  })
})

describe('disponibilidad', () => {
  it('desactivar y activar son idempotentes y no tocan el nombre ni las auditorías existentes', async () => {
    const auth = await as('manager')
    const org = (await create('ACME')).body.data
    const audit = await createAuditFixture(db, org.id)

    for (let i = 0; i < 2; i++) {
      const off = await api().post(`${BASE}/${org.id}/deactivate`).set('authorization', auth).expect(200)
      expect(off.body.data).toMatchObject({ name: 'ACME', isActive: false })
    }
    expect(await db.audit.findUnique({ where: { id: audit.id } })).not.toBeNull()

    for (let i = 0; i < 2; i++) {
      const on = await api().post(`${BASE}/${org.id}/activate`).set('authorization', auth).expect(200)
      expect(on.body.data.isActive).toBe(true)
    }
  })

  it('sobre una inexistente: 404', async () => {
    const auth = await as('manager')
    await api().post(`${BASE}/${UNKNOWN_ID}/activate`).set('authorization', auth).expect(404)
    await api().post(`${BASE}/${UNKNOWN_ID}/deactivate`).set('authorization', auth).expect(404)
  })
})
