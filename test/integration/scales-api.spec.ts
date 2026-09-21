import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { listRoutes } from '../../src/platform/authz/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { createAuditFixture } from './support/db.js'

const BASE = '/api/v1/scales'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

const CONFORMITY = [
  { value: 0, label: 'No cumple' },
  { value: 50, label: 'Parcial' },
  { value: 100, label: 'Cumple' },
]

async function create(body: Record<string, unknown>, role: TestRole = 'manager') {
  return api()
    .post(BASE)
    .set('authorization', await as(role))
    .send(body)
}
const conformity = (name = 'ISO 27001 – Conformidad') => create({ name, dimension: 'CONFORMITY', levels: CONFORMITY })

/** Una escala creada y ya usada por una auditoría (su estructura queda congelada). */
async function usedScale() {
  const scale = (await conformity()).body.data
  const org = await db.organization.create({ data: { name: 'ACME' } })
  await createAuditFixture(db, org.id, 'AUD-USED-1', scale.id)
  return scale
}
const levelId = (scale: { levels: Array<{ id: string; label: string }> }, label: string) =>
  scale.levels.find((l) => l.label === label)!.id

describe('permisos', () => {
  it('sin token: 401', async () => {
    await api().get(BASE).expect(401)
  })

  it('un auditor puede consultar las escalas pero no modificarlas', async () => {
    const scale = (await conformity()).body.data
    const auth = await as('auditor')
    await api().get(BASE).set('authorization', auth).expect(200)
    await api().get(`${BASE}/${scale.id}`).set('authorization', auth).expect(200)
    await api().post(BASE).set('authorization', auth).send({ name: 'X' }).expect(403)
    await api().patch(`${BASE}/${scale.id}`).set('authorization', auth).send({ name: 'X' }).expect(403)
    await api().post(`${BASE}/${scale.id}/deactivate`).set('authorization', auth).expect(403)
    await api().delete(`${BASE}/${scale.id}`).set('authorization', auth).expect(403)
    await api().post(`${BASE}/${scale.id}/levels`).set('authorization', auth).send({ value: 1, label: 'x' }).expect(403)
    const id = levelId(scale, 'Parcial')
    await api().patch(`${BASE}/${scale.id}/levels/${id}`).set('authorization', auth).send({ label: 'x' }).expect(403)
    await api().delete(`${BASE}/${scale.id}/levels/${id}`).set('authorization', auth).expect(403)
    expect(await db.scaleLevel.count()).toBe(3)
  })

  it('cada endpoint declara la acción que le corresponde', () => {
    const declared = listRoutes(t.app().get(DiscoveryService), t.app().get(MetadataScanner), t.app().get(Reflector))
      .filter((route) => route.handler.startsWith('ScalesController.'))
      .map((route) => {
        const access = route.access
        const can = access?.kind === 'can' ? `${access.action} ${access.subject}` : access?.kind
        return `${route.method} ${route.path} → ${can}`
      })
      .sort()
    expect(declared).toEqual(
      [
        'GET /scales → read Scale',
        'GET /scales/:id → read Scale',
        'POST /scales → create Scale',
        'PATCH /scales/:id → update Scale',
        'POST /scales/:id/activate → update Scale',
        'POST /scales/:id/deactivate → update Scale',
        'DELETE /scales/:id → delete Scale',
        'POST /scales/:id/levels → update Scale',
        'PATCH /scales/:id/levels/:levelId → update Scale',
        'DELETE /scales/:id/levels/:levelId → update Scale',
      ].sort(),
    )
  })
})

describe('crear', () => {
  it('201: nace con sus opciones ordenadas por puntaje, puntajes como número y sin campos internos', async () => {
    const res = await create({
      name: '  Madurez  ',
      dimension: 'MATURITY',
      levels: [
        { value: 2.5, label: 'Definido', description: '  Documentado  ' },
        { value: 0, label: 'Inexistente', description: '   ' },
        { value: 1, label: 'Inicial' },
      ],
    })
    expect(res.status).toBe(201)
    expect(Object.keys(res.body.data).sort()).toEqual([
      'createdAt',
      'dimension',
      'id',
      'isActive',
      'levels',
      'name',
      'updatedAt',
    ])
    expect(res.body.data).toMatchObject({ name: 'Madurez', dimension: 'MATURITY', isActive: true })
    expect(res.body.data.levels.map((l: { value: number; label: string }) => [l.value, l.label])).toEqual([
      [0, 'Inexistente'],
      [1, 'Inicial'],
      [2.5, 'Definido'],
    ])
    expect(res.body.data.levels.map((l: { description: string | null }) => l.description)).toEqual([
      null,
      null,
      'Documentado',
    ])
    expect(Object.keys(res.body.data.levels[0]).sort()).toEqual(['description', 'id', 'label', 'value'])
  })

  it('sella quién la creó', async () => {
    const res = await conformity()
    const row = await db.scale.findUniqueOrThrow({ where: { id: res.body.data.id } })
    const user = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(row.createdById).toBe(user.id)
  })

  it.each([
    ['nombre vacío', { name: ' ', dimension: 'CONFORMITY', levels: CONFORMITY }],
    ['dimensión inválida', { name: 'E', dimension: 'BINARY', levels: CONFORMITY }],
    ['sin dimensión', { name: 'E', levels: CONFORMITY }],
    ['sin opciones (falta el campo)', { name: 'E', dimension: 'CONFORMITY' }],
    ['puntaje negativo', { name: 'E', dimension: 'MATURITY', levels: [{ value: -1, label: 'a' }, ...CONFORMITY] }],
    [
      'puntaje con 3 decimales',
      { name: 'E', dimension: 'MATURITY', levels: [{ value: 0.125, label: 'a' }, ...CONFORMITY] },
    ],
    [
      'puntaje fuera de rango',
      { name: 'E', dimension: 'MATURITY', levels: [{ value: 1000, label: 'a' }, ...CONFORMITY] },
    ],
    ['etiqueta vacía', { name: 'E', dimension: 'MATURITY', levels: [{ value: 7, label: '' }, ...CONFORMITY] }],
    [
      'demasiadas opciones',
      {
        name: 'E',
        dimension: 'MATURITY',
        levels: Array.from({ length: 21 }, (_v, i) => ({ value: i, label: `n${i}` })),
      },
    ],
  ])('%s: 400 VALIDATION_FAILED y no se crea nada', async (_caso, body) => {
    const res = await create(body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(await db.scale.count()).toBe(0)
  })

  it.each([
    ['menos de 2 opciones', [{ value: 1, label: 'Única' }], 'MIN_LEVELS'],
    ['sin opciones', [], 'MIN_LEVELS'],
    [
      'puntaje repetido',
      [
        { value: 1, label: 'a' },
        { value: 1, label: 'b' },
      ],
      'DUPLICATE_VALUE',
    ],
    [
      'etiqueta repetida (mayúsculas y espacios)',
      [
        { value: 0, label: 'No cumple' },
        { value: 1, label: ' no   CUMPLE' },
      ],
      'DUPLICATE_LABEL',
    ],
  ])(
    '%s: 422 SCALE_LEVELS_INVALID con details.rule y no se crea nada (ni la escala ni sus opciones)',
    async (_caso, levels, rule) => {
      const res = await create({ name: 'E', dimension: 'CONFORMITY', levels })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('SCALE_LEVELS_INVALID')
      expect(res.body.error.details.rule).toBe(rule)
      expect(await db.scale.count()).toBe(0)
      expect(await db.scaleLevel.count()).toBe(0)
    },
  )

  it('un nombre repetido (sin distinguir mayúsculas): 409 SCALE_NAME_TAKEN y no deja opciones huérfanas', async () => {
    await conformity('ISO')
    const res = await conformity('iso')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SCALE_NAME_TAKEN')
    expect(await db.scale.count()).toBe(1)
    expect(await db.scaleLevel.count()).toBe(3)
  })

  it('campos que no existen se ignoran: no se puede fijar isActive al crear', async () => {
    const res = await create({ name: 'E', dimension: 'CONFORMITY', levels: CONFORMITY, isActive: false })
    expect(res.status).toBe(201)
    expect(res.body.data.isActive).toBe(true)
  })
})

describe('listar y ver', () => {
  beforeEach(async () => {
    await conformity('Delta')
    await conformity('alfa')
    await conformity('Bravo')
  })

  it('ordena por nombre (sin distinguir mayúsculas), pagina y trae las opciones', async () => {
    const auth = await as('manager')
    const res = await api().get(BASE).query({ pageSize: 2 }).set('authorization', auth).expect(200)
    expect(res.body.data.map((s: { name: string }) => s.name)).toEqual(['alfa', 'Bravo'])
    expect(res.body.data[0].levels).toHaveLength(3)
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 })
  })

  it('busca por nombre y filtra por disponibilidad', async () => {
    const auth = await as('manager')
    const bravo = await db.scale.findFirstOrThrow({ where: { name: 'Bravo' } })
    await api().post(`${BASE}/${bravo.id}/deactivate`).set('authorization', auth).expect(200)

    const found = await api().get(BASE).query({ q: 'ALF' }).set('authorization', auth).expect(200)
    expect(found.body.data.map((s: { name: string }) => s.name)).toEqual(['alfa'])
    const active = await api().get(BASE).query({ active: 'true' }).set('authorization', auth).expect(200)
    expect(active.body.meta.total).toBe(2)
  })

  it('ver: 200; inexistente 404 SCALE_NOT_FOUND; id mal formado 400', async () => {
    const auth = await as('manager')
    const one = await db.scale.findFirstOrThrow({ where: { name: 'Bravo' } })
    const ok = await api().get(`${BASE}/${one.id}`).set('authorization', auth).expect(200)
    expect(ok.body.data.levels.map((l: { value: number }) => l.value)).toEqual([0, 50, 100])
    const missing = await api().get(`${BASE}/${UNKNOWN_ID}`).set('authorization', auth)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('SCALE_NOT_FOUND')
    await api().get(`${BASE}/x`).set('authorization', auth).expect(400)
  })
})

describe('renombrar, disponibilidad y borrar', () => {
  it('renombrar cambia solo el nombre: la dimensión NO se edita aunque se envíe', async () => {
    const scale = (await conformity('Vieja')).body.data
    const res = await api()
      .patch(`${BASE}/${scale.id}`)
      .set('authorization', await as('manager'))
      .send({ name: 'Nueva', dimension: 'MATURITY', isActive: false })
      .expect(200)
    expect(res.body.data).toMatchObject({ name: 'Nueva', dimension: 'CONFORMITY', isActive: true })
    expect(res.body.data.levels).toHaveLength(3)
  })

  it('renombrar: nombre tomado 409; inexistente 404', async () => {
    const auth = await as('manager')
    const a = (await conformity('A')).body.data
    await conformity('B')
    const taken = await api().patch(`${BASE}/${a.id}`).set('authorization', auth).send({ name: 'b' })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('SCALE_NAME_TAKEN')
    await api().patch(`${BASE}/${UNKNOWN_ID}`).set('authorization', auth).send({ name: 'Z' }).expect(404)
  })

  it('desactivar/activar: idempotentes y no tocan las opciones ni las auditorías', async () => {
    const auth = await as('manager')
    const scale = await usedScale()
    for (let i = 0; i < 2; i++) {
      const off = await api().post(`${BASE}/${scale.id}/deactivate`).set('authorization', auth).expect(200)
      expect(off.body.data).toMatchObject({ isActive: false })
      expect(off.body.data.levels).toHaveLength(3)
    }
    await api().post(`${BASE}/${scale.id}/activate`).set('authorization', auth).expect(200)
    expect(await db.audit.count()).toBe(1)
    await api().post(`${BASE}/${UNKNOWN_ID}/activate`).set('authorization', auth).expect(404)
  })

  it('borrar una sin uso: 204 y sus opciones caen en cascada; repetir 404', async () => {
    const auth = await as('manager')
    const scale = (await conformity()).body.data
    await api().delete(`${BASE}/${scale.id}`).set('authorization', auth).expect(204)
    expect(await db.scale.count()).toBe(0)
    expect(await db.scaleLevel.count()).toBe(0)
    const again = await api().delete(`${BASE}/${scale.id}`).set('authorization', auth)
    expect(again.status).toBe(404)
    expect(again.body.error.code).toBe('SCALE_NOT_FOUND')
  })

  it('borrar una usada por una auditoría: 409 SCALE_IN_USE y no se pierde nada', async () => {
    const scale = await usedScale()
    const res = await api()
      .delete(`${BASE}/${scale.id}`)
      .set('authorization', await as('manager'))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SCALE_IN_USE')
    expect(await db.scale.count()).toBe(1)
    expect(await db.scaleLevel.count()).toBe(3)
  })
})

describe('opciones de una escala SIN uso', () => {
  it('agregar: 201 y devuelve la escala completa con la opción en su lugar', async () => {
    const scale = (await conformity()).body.data
    const res = await api()
      .post(`${BASE}/${scale.id}/levels`)
      .set('authorization', await as('manager'))
      .send({ value: 75, label: 'Casi cumple', description: 'Falta un detalle' })
    expect(res.status).toBe(201)
    expect(res.body.data.levels.map((l: { value: number }) => l.value)).toEqual([0, 50, 75, 100])
  })

  it('agregar con puntaje o etiqueta repetidos: 422 con la regla; no se agrega', async () => {
    const auth = await as('manager')
    const scale = (await conformity()).body.data
    const value = await api()
      .post(`${BASE}/${scale.id}/levels`)
      .set('authorization', auth)
      .send({ value: 50, label: 'Otra' })
    expect(value.status).toBe(422)
    expect(value.body.error.details.rule).toBe('DUPLICATE_VALUE')
    const label = await api()
      .post(`${BASE}/${scale.id}/levels`)
      .set('authorization', auth)
      .send({ value: 60, label: 'parcial' })
    expect(label.body.error.details.rule).toBe('DUPLICATE_LABEL')
    expect(await db.scaleLevel.count()).toBe(3)
  })

  it('editar: etiqueta, descripción (null la borra) y puntaje', async () => {
    const auth = await as('manager')
    const scale = (await conformity()).body.data
    const id = levelId(scale, 'Parcial')
    const res = await api()
      .patch(`${BASE}/${scale.id}/levels/${id}`)
      .set('authorization', auth)
      .send({ label: 'Cumple en parte', value: 60, description: 'Texto' })
      .expect(200)
    expect(res.body.data.levels.find((l: { id: string }) => l.id === id)).toMatchObject({
      label: 'Cumple en parte',
      value: 60,
      description: 'Texto',
    })
    const cleared = await api()
      .patch(`${BASE}/${scale.id}/levels/${id}`)
      .set('authorization', auth)
      .send({ description: null })
      .expect(200)
    expect(cleared.body.data.levels.find((l: { id: string }) => l.id === id).description).toBeNull()
  })

  it('editar: puntaje o etiqueta que chocan con otra opción → 422; cuerpo vacío → 400; opción ajena o inexistente → 404', async () => {
    const auth = await as('manager')
    const scale = (await conformity()).body.data
    const other = (await conformity('Otra')).body.data
    const id = levelId(scale, 'Parcial')
    const url = `${BASE}/${scale.id}/levels/${id}`

    const value = await api().patch(url).set('authorization', auth).send({ value: 100 })
    expect(value.status).toBe(422)
    expect(value.body.error.details.rule).toBe('DUPLICATE_VALUE')
    const label = await api().patch(url).set('authorization', auth).send({ label: 'CUMPLE' })
    expect(label.body.error.details.rule).toBe('DUPLICATE_LABEL')
    await api().patch(url).set('authorization', auth).send({}).expect(400)
    await api()
      .patch(`${BASE}/${scale.id}/levels/${UNKNOWN_ID}`)
      .set('authorization', auth)
      .send({ label: 'x' })
      .expect(404)
    const foreign = await api()
      .patch(`${BASE}/${scale.id}/levels/${levelId(other, 'Parcial')}`)
      .set('authorization', auth)
      .send({ label: 'x' })
    expect(foreign.status).toBe(404)
    expect(foreign.body.error.code).toBe('SCALE_LEVEL_NOT_FOUND')
  })

  it('quitar: devuelve la escala; no puede dejarla con menos de 2 opciones', async () => {
    const auth = await as('manager')
    const scale = (await conformity()).body.data
    const after = await api()
      .delete(`${BASE}/${scale.id}/levels/${levelId(scale, 'Parcial')}`)
      .set('authorization', auth)
      .expect(200)
    expect(after.body.data.levels.map((l: { label: string }) => l.label)).toEqual(['No cumple', 'Cumple'])

    const last = await api()
      .delete(`${BASE}/${scale.id}/levels/${levelId(scale, 'Cumple')}`)
      .set('authorization', auth)
    expect(last.status).toBe(422)
    expect(last.body.error).toMatchObject({ code: 'SCALE_LEVELS_INVALID', details: { rule: 'MIN_LEVELS' } })
    expect(await db.scaleLevel.count()).toBe(2)
  })

  it('quitar una opción inexistente: 404', async () => {
    const scale = (await conformity()).body.data
    await api()
      .delete(`${BASE}/${scale.id}/levels/${UNKNOWN_ID}`)
      .set('authorization', await as('manager'))
      .expect(404)
  })
})

describe('opciones de una escala YA USADA: la estructura queda congelada', () => {
  it('agregar, quitar o cambiar un puntaje: 409 SCALE_STRUCTURE_LOCKED; nada cambia', async () => {
    const auth = await as('manager')
    const scale = await usedScale()
    const id = levelId(scale, 'Parcial')

    const add = await api()
      .post(`${BASE}/${scale.id}/levels`)
      .set('authorization', auth)
      .send({ value: 75, label: 'Nueva' })
    expect(add.status).toBe(409)
    expect(add.body.error.code).toBe('SCALE_STRUCTURE_LOCKED')
    const remove = await api().delete(`${BASE}/${scale.id}/levels/${id}`).set('authorization', auth)
    expect(remove.body.error.code).toBe('SCALE_STRUCTURE_LOCKED')
    const value = await api().patch(`${BASE}/${scale.id}/levels/${id}`).set('authorization', auth).send({ value: 60 })
    expect(value.body.error.code).toBe('SCALE_STRUCTURE_LOCKED')

    const levels = await db.scaleLevel.findMany({ where: { scaleId: scale.id }, orderBy: { value: 'asc' } })
    expect(levels.map((l) => [l.value.toNumber(), l.label])).toEqual([
      [0, 'No cumple'],
      [50, 'Parcial'],
      [100, 'Cumple'],
    ])
  })

  it('corregir una etiqueta o descripción sí se puede (errata), y repetir el mismo puntaje no cuenta como cambio', async () => {
    const auth = await as('manager')
    const scale = await usedScale()
    const id = levelId(scale, 'Parcial')
    const res = await api()
      .patch(`${BASE}/${scale.id}/levels/${id}`)
      .set('authorization', auth)
      .send({ label: 'Cumple parcialmente', description: 'Corregido', value: 50 })
      .expect(200)
    expect(res.body.data.levels.find((l: { id: string }) => l.id === id)).toMatchObject({
      label: 'Cumple parcialmente',
      value: 50,
      description: 'Corregido',
    })
  })

  it('una etiqueta corregida sigue sin poder repetir otra de la misma escala', async () => {
    const scale = await usedScale()
    const res = await api()
      .patch(`${BASE}/${scale.id}/levels/${levelId(scale, 'Parcial')}`)
      .set('authorization', await as('manager'))
      .send({ label: 'cumple' })
    expect(res.status).toBe(422)
    expect(res.body.error.details.rule).toBe('DUPLICATE_LABEL')
  })
})
