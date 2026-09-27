import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { listRoutes } from '../../src/platform/authz/index.js'
import { useTestApi } from './support/api.js'

const BASE = '/api/v1/users'
const t = useTestApi()
const { api, as } = t

async function seedUsers() {
  await t.userId('admin', 'root')
  await t.userId('manager', 'gerardo')
  await t.userId('auditor', 'ana')
  await t.userId('auditor', 'beto')
  await t.userId('adminManager', 'mixto')
}

const usernames = (body: { data: Array<{ username: string }> }) => body.data.map((u) => u.username)

describe('GET /users (directorio, solo lectura)', () => {
  it('sin token: 401; un AUDITOR no lo lee: 403', async () => {
    await api().get(BASE).expect(401)
    await api()
      .get(BASE)
      .set('authorization', await as('auditor'))
      .expect(403)
  })

  it('un GERENTE y el ADMIN lo leen; devuelve solo lo necesario, ordenado por nombre y paginado', async () => {
    await seedUsers()
    // quien consulta también es un usuario sincronizado: se suma a los 5 sembrados (`manager` primero, `admin` después)
    const manager = await api()
      .get(BASE)
      .set('authorization', await as('manager'))
      .expect(200)
    expect(manager.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 6 })
    expect(Object.keys(manager.body.data[0]).sort()).toEqual(['email', 'id', 'name', 'roles', 'username'])
    const admin = await api()
      .get(BASE)
      .set('authorization', await as('admin'))
      .expect(200)
    expect(admin.body.meta).toMatchObject({ total: 7 })
    const paged = await api()
      .get(`${BASE}?pageSize=2&page=2`)
      .set('authorization', await as('manager'))
      .expect(200)
    expect(paged.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 7, totalPages: 4 })
    expect(paged.body.data).toHaveLength(2)
  })

  it('q busca por nombre, usuario o correo sin distinguir mayúsculas', async () => {
    await seedUsers()
    const auth = await as('manager')
    expect(usernames((await api().get(`${BASE}?q=ANA%40EJEMPLO`).set('authorization', auth)).body)).toEqual(['ana'])
    expect(usernames((await api().get(`${BASE}?q=beto@EJEMPLO`).set('authorization', auth)).body)).toEqual(['beto'])
    expect((await api().get(`${BASE}?q=nadie`).set('authorization', auth)).body.data).toEqual([])
  })

  it('role filtra por rol global; eligible=true deja solo a quien puede ser miembro (AUDITOR o GERENTE)', async () => {
    await seedUsers()
    const auth = await as('manager')
    const byRole = async (role: string) =>
      usernames((await api().get(`${BASE}?role=${role}`).set('authorization', auth)).body).sort()
    expect(await byRole('AUDITOR')).toEqual(['ana', 'beto'])
    expect(await byRole('GERENTE')).toEqual(['gerardo', 'manager', 'mixto'])
    expect(await byRole('ADMIN')).toEqual(['mixto', 'root'])

    const eligible = await api().get(`${BASE}?eligible=true`).set('authorization', auth).expect(200)
    expect(usernames(eligible.body).sort()).toEqual(['ana', 'beto', 'gerardo', 'manager', 'mixto'])
  })

  it('un role o un pageSize inválidos: 400', async () => {
    const auth = await as('manager')
    await api().get(`${BASE}?role=INSPECTOR`).set('authorization', auth).expect(400)
    await api().get(`${BASE}?pageSize=1000`).set('authorization', auth).expect(400)
  })

  it('cada endpoint declara su acción; y no hay escritura (el directorio es un espejo de Authentik)', () => {
    const declared = listRoutes(t.app().get(DiscoveryService), t.app().get(MetadataScanner), t.app().get(Reflector))
      .filter((route) => route.handler.startsWith('UsersController.'))
      .map((route) => {
        const access = route.access
        return `${route.method} ${route.path} → ${access?.kind === 'can' ? `${access.action} ${access.subject}` : access?.kind}`
      })
    expect(declared).toEqual(['GET /users → read User'])
  })
})
