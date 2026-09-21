import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { listRoutes } from '../../src/platform/authz/index.js'
import { useTestApi } from './support/api.js'
import { type SeedNode, seedControls } from './support/templates.js'

const T = '/api/v1/templates'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

async function createTemplate(name = 'ISO/IEC 27001:2022', role: 'manager' | 'admin' = 'manager') {
  return api()
    .post(T)
    .set('authorization', await as(role))
    .send({ name })
}
const idOf = async (name?: string): Promise<string> => (await createTemplate(name)).body.data.id
const publish = (id: string) => db.template.update({ where: { id }, data: { status: 'PUBLISHED' } })

describe('permisos', () => {
  it('sin token: 401', async () => {
    await api().get(T).expect(401)
    await api().get(`${T}/${UNKNOWN_ID}/controls`).expect(401)
  })

  it('un auditor consulta plantillas y controles, pero no los modifica', async () => {
    const id = await idOf()
    const auth = await as('auditor')
    await api().get(T).set('authorization', auth).expect(200)
    await api().get(`${T}/${id}`).set('authorization', auth).expect(200)
    await api().get(`${T}/${id}/controls`).set('authorization', auth).expect(200)
    await api().post(T).set('authorization', auth).send({ name: 'X' }).expect(403)
    await api().patch(`${T}/${id}`).set('authorization', auth).send({ name: 'X' }).expect(403)
    await api().delete(`${T}/${id}`).set('authorization', auth).expect(403)
    await api().post(`${T}/${id}/controls`).set('authorization', auth).send({ title: 'x' }).expect(403)
    await api().patch(`${T}/${id}/controls/${UNKNOWN_ID}`).set('authorization', auth).send({ title: 'x' }).expect(403)
    await api()
      .post(`${T}/${id}/controls/${UNKNOWN_ID}/move`)
      .set('authorization', auth)
      .send({ parentId: null, position: 0 })
      .expect(403)
    await api().delete(`${T}/${id}/controls/${UNKNOWN_ID}`).set('authorization', auth).expect(403)
  })

  it('cada endpoint declara la acción que le corresponde', () => {
    const declared = listRoutes(t.app().get(DiscoveryService), t.app().get(MetadataScanner), t.app().get(Reflector))
      .filter((r) => r.handler.startsWith('TemplatesController.') || r.handler.startsWith('ControlsController.'))
      .map(
        (r) =>
          `${r.method} ${r.path} → ${r.access?.kind === 'can' ? `${r.access.action} ${r.access.subject}` : r.access?.kind}`,
      )
      .sort()
    expect(declared).toEqual(
      [
        'GET /templates → read Template',
        'GET /templates/:id → read Template',
        'POST /templates → create Template',
        'PATCH /templates/:id → update Template',
        'DELETE /templates/:id → delete Template',
        'POST /templates/:id/publish → update Template',
        'POST /templates/:id/archive → update Template',
        'POST /templates/import → create Template',
        'GET /templates/:id/export → read Template',
        'GET /templates/:templateId/controls → read Template',
        'POST /templates/:templateId/controls → update Template',
        'PATCH /templates/:templateId/controls/:controlId → update Template',
        'POST /templates/:templateId/controls/:controlId/move → update Template',
        'DELETE /templates/:templateId/controls/:controlId → update Template',
      ].sort(),
    )
  })
})

describe('plantillas', () => {
  it('crear: 201, en borrador y vacía; solo la vista pública; sella quién la creó', async () => {
    const res = await createTemplate('  ISO/IEC 27001:2022  ')
    expect(res.status).toBe(201)
    expect(Object.keys(res.body.data).sort()).toEqual([
      'allowedActions',
      'controlCount',
      'createdAt',
      'id',
      'name',
      'status',
      'updatedAt',
    ])
    expect(res.body.data).toMatchObject({
      name: 'ISO/IEC 27001:2022',
      status: 'DRAFT',
      controlCount: 0,
      allowedActions: ['PUBLISH'],
    })
    const row = await db.template.findUniqueOrThrow({ where: { id: res.body.data.id } })
    const user = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(row.createdById).toBe(user.id)
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '  '],
    ['demasiado largo', 'x'.repeat(201)],
  ])('nombre %s: 400', async (_c, name) => {
    expect((await createTemplate(name)).status).toBe(400)
    expect(await db.template.count()).toBe(0)
  })

  it('un nombre repetido (sin distinguir mayúsculas): 409 TEMPLATE_NAME_TAKEN', async () => {
    await createTemplate('COBIT 5')
    const res = await createTemplate('cobit 5')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TEMPLATE_NAME_TAKEN')
  })

  it('listar: orden por nombre, paginación, búsqueda y filtro por estado; ver: 404 y 400', async () => {
    const auth = await as('manager')
    for (const name of ['Delta', 'alfa', 'Charlie', 'Bravo']) await createTemplate(name)
    await publish((await db.template.findFirstOrThrow({ where: { name: 'Bravo' } })).id)

    const first = await api().get(T).query({ pageSize: 3 }).set('authorization', auth).expect(200)
    expect(first.body.data.map((x: { name: string }) => x.name)).toEqual(['alfa', 'Bravo', 'Charlie'])
    expect(first.body.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 })
    const found = await api().get(T).query({ q: 'ALF' }).set('authorization', auth).expect(200)
    expect(found.body.data.map((x: { name: string }) => x.name)).toEqual(['alfa'])
    const published = await api().get(T).query({ status: 'PUBLISHED' }).set('authorization', auth).expect(200)
    expect(published.body.data).toMatchObject([{ name: 'Bravo', status: 'PUBLISHED', allowedActions: ['ARCHIVE'] }])
    await api().get(T).query({ status: 'NOPE' }).set('authorization', auth).expect(400)

    const missing = await api().get(`${T}/${UNKNOWN_ID}`).set('authorization', auth)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('TEMPLATE_NOT_FOUND')
    await api().get(`${T}/x`).set('authorization', auth).expect(400)
  })

  it('renombrar y borrar solo en borrador; una publicada o archivada es inmutable (409 TEMPLATE_NOT_EDITABLE)', async () => {
    const auth = await as('manager')
    const id = await idOf('Vieja')
    const renamed = await api().patch(`${T}/${id}`).set('authorization', auth).send({ name: 'Nueva' }).expect(200)
    expect(renamed.body.data.name).toBe('Nueva')

    for (const status of ['PUBLISHED', 'ARCHIVED'] as const) {
      await db.template.update({ where: { id }, data: { status } })
      const rename = await api().patch(`${T}/${id}`).set('authorization', auth).send({ name: 'Otra' })
      expect(rename.status).toBe(409)
      expect(rename.body.error.code).toBe('TEMPLATE_NOT_EDITABLE')
      const del = await api().delete(`${T}/${id}`).set('authorization', auth)
      expect(del.body.error.code).toBe('TEMPLATE_NOT_EDITABLE')
    }
    expect(await db.template.count()).toBe(1)
    await api().patch(`${T}/${UNKNOWN_ID}`).set('authorization', auth).send({ name: 'Z' }).expect(404)
  })

  it('borrar un borrador elimina también sus controles', async () => {
    const auth = await as('manager')
    const id = await idOf()
    await api().post(`${T}/${id}/controls`).set('authorization', auth).send({ title: 'Dominio' }).expect(201)
    expect(await db.control.count()).toBe(1)
    await api().delete(`${T}/${id}`).set('authorization', auth).expect(204)
    expect(await db.template.count()).toBe(0)
    expect(await db.control.count()).toBe(0)
    await api().delete(`${T}/${id}`).set('authorization', auth).expect(404)
  })
})

// ── Controles ────────────────────────────────────────────────────────────────────────────────────────────────
type View = {
  id: string
  parentId: string | null
  reference: string | null
  title: string
  description: string | null
  position: number
  depth: number
  isLeaf: boolean
}

async function add(
  templateId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any; list: View[] }> {
  const res = await api()
    .post(`${T}/${templateId}/controls`)
    .set('authorization', await as('manager'))
    .send(body)
  return { status: res.status, body: res.body, list: res.body.data }
}
const list = async (templateId: string): Promise<View[]> =>
  (
    await api()
      .get(`${T}/${templateId}/controls`)
      .set('authorization', await as('manager'))
      .expect(200)
  ).body.data
const titles = (views: View[]) => views.map((v) => v.title)
const byTitle = (views: View[], title: string) => views.find((v) => v.title === title)!
const dbPositions = async (templateId: string, parentId: string | null) =>
  (
    await db.control.findMany({
      where: { templateId, parentId },
      orderBy: { position: 'asc' },
      select: { title: true, position: true },
    })
  ).map((c) => [c.title, c.position])

const seed = (templateId: string, spec: readonly SeedNode[]) => seedControls(db, templateId, spec)

describe('controles: crear y listar', () => {
  it('arma un árbol de profundidad desigual y lo lista en orden de lectura con nivel e hoja', async () => {
    const id = await idOf()
    const a = byTitle((await add(id, { title: 'A.5 Organizacional', reference: 'A.5' })).list, 'A.5 Organizacional')
    expect(a).toMatchObject({ parentId: null, reference: 'A.5', depth: 0, isLeaf: true, position: 0 })
    await add(id, { title: 'A.6 Personas', reference: 'A.6' })
    const withChild = (await add(id, { parentId: a.id, title: 'Políticas' })).list
    const pol = byTitle(withChild, 'Políticas')
    await add(id, { parentId: pol.id, title: 'Revisión anual', description: '  Cada 12 meses  ' })
    const final = await list(id)

    expect(titles(final)).toEqual(['A.5 Organizacional', 'Políticas', 'Revisión anual', 'A.6 Personas'])
    expect(final.map((v) => [v.depth, v.isLeaf])).toEqual([
      [0, false],
      [1, false],
      [2, true],
      [0, true],
    ])
    expect(byTitle(final, 'Revisión anual').description).toBe('Cada 12 meses')
    expect(byTitle(final, 'Políticas').reference).toBeNull()
    expect(Object.keys(final[0]!).sort()).toEqual([
      'depth',
      'description',
      'id',
      'isLeaf',
      'parentId',
      'position',
      'reference',
      'title',
    ])
  })

  it('la referencia es texto libre: se puede repetir, va vacía o con cualquier forma', async () => {
    const id = await idOf()
    for (const reference of ['A.5.1', 'A.5.1', 'Art. 5', 'II', '  ', null]) {
      expect((await add(id, { title: `c-${String(reference)}`, reference })).status).toBe(201)
    }
    expect((await list(id)).map((v) => v.reference)).toEqual(['A.5.1', 'A.5.1', 'Art. 5', 'II', null, null])
  })

  it('sin posición va al final; con posición se inserta y los hermanos quedan numerados 0..n-1 sin huecos', async () => {
    const id = await idOf()
    for (const title of ['a', 'b', 'c']) await add(id, { title })
    const inserted = await add(id, { title: 'x', position: 1 })
    expect(titles(inserted.list)).toEqual(['a', 'x', 'b', 'c'])
    expect(await dbPositions(id, null)).toEqual([
      ['a', 0],
      ['x', 1],
      ['b', 2],
      ['c', 3],
    ])
    const first = await add(id, { title: 'primero', position: 0 })
    expect(titles(first.list)[0]).toBe('primero')
    const beyond = await add(id, { title: 'ultimo', position: 99 })
    expect(titles(beyond.list).at(-1)).toBe('ultimo')
    expect((await dbPositions(id, null)).map((p) => p[1])).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('el orden lo da la posición, no el texto: "A.10" después de "A.5" y "A.2" antes, según se coloquen', async () => {
    const id = await idOf()
    for (const reference of ['A.5', 'A.10', 'A.2']) await add(id, { title: reference, reference })
    expect(titles(await list(id))).toEqual(['A.5', 'A.10', 'A.2'])
  })

  it.each([
    ['sin título', { title: '' }],
    ['título solo espacios', { title: '   ' }],
    ['posición negativa', { title: 'x', position: -1 }],
    ['posición decimal', { title: 'x', position: 1.5 }],
    ['padre que no es uuid', { title: 'x', parentId: 'no' }],
    ['título demasiado largo', { title: 'x'.repeat(501) }],
  ])('%s: 400 y no se crea nada', async (_c, body) => {
    const id = await idOf()
    expect((await add(id, body)).status).toBe(400)
    expect(await db.control.count()).toBe(0)
  })

  it('un padre inexistente o de OTRA plantilla: 422 CONTROL_PARENT_INVALID', async () => {
    const id = await idOf('Una')
    const other = await idOf('Otra')
    const foreign = byTitle((await add(other, { title: 'ajeno' })).list, 'ajeno')
    for (const parentId of [UNKNOWN_ID, foreign.id]) {
      const res = await add(id, { title: 'x', parentId })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('CONTROL_PARENT_INVALID')
    }
    expect(await db.control.count({ where: { templateId: id } })).toBe(0)
  })

  it('plantilla inexistente: 404', async () => {
    expect((await add(UNKNOWN_ID, { title: 'x' })).status).toBe(404)
    await api()
      .get(`${T}/${UNKNOWN_ID}/controls`)
      .set('authorization', await as('manager'))
      .expect(404)
  })

  it('el árbol tiene un tope de profundidad (10 niveles): el siguiente es 422 CONTROL_DEPTH_EXCEEDED', async () => {
    const id = await idOf()
    let parentId: string | null = null
    for (let level = 0; level < 10; level++) {
      const row: { id: string } = await db.control.create({
        data: { templateId: id, parentId, title: `n${level}`, position: 0 },
      })
      parentId = row.id
    }
    const res = await add(id, { parentId, title: 'demasiado profundo' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('CONTROL_DEPTH_EXCEEDED')
    expect(await db.control.count()).toBe(10)
  })

  it('una plantilla de ~300 controles se lista completa y en orden', async () => {
    const id = await idOf()
    const domains = Array.from({ length: 10 }, (_v, d) => ({
      title: `D${d}`,
      kids: Array.from({ length: 5 }, (_w, o) => ({
        title: `D${d}.O${o}`,
        kids: Array.from({ length: 5 }, (_x, c) => ({ title: `D${d}.O${o}.C${c}` })),
      })),
    }))
    await seed(id, domains)
    const all = await list(id)
    expect(all).toHaveLength(10 + 50 + 250)
    expect(all.slice(0, 3).map((v) => v.title)).toEqual(['D0', 'D0.O0', 'D0.O0.C0'])
    expect(all.filter((v) => v.isLeaf)).toHaveLength(250)
    expect(
      (
        await api()
          .get(T)
          .set('authorization', await as('manager'))
      ).body.data[0].controlCount,
    ).toBe(310)
  })
})

describe('controles: editar contenido', () => {
  it('cambia referencia, título y descripción (null o vacío las borra) sin mover el control', async () => {
    const id = await idOf()
    const { list: l } = await add(id, { title: 'Original', reference: 'A.1', description: 'texto' })
    const control = l[0]!
    const url = `${T}/${id}/controls/${control.id}`
    const auth = await as('manager')
    const res = await api().patch(url).set('authorization', auth).send({ title: 'Nuevo', reference: 'B.2' }).expect(200)
    expect(res.body.data).toMatchObject({
      id: control.id,
      title: 'Nuevo',
      reference: 'B.2',
      description: 'texto',
      position: 0,
      depth: 0,
      isLeaf: true,
    })
    const cleared = await api()
      .patch(url)
      .set('authorization', auth)
      .send({ reference: null, description: '' })
      .expect(200)
    expect(cleared.body.data).toMatchObject({ reference: null, description: null })
  })

  it('cuerpo vacío o título vacío: 400; control inexistente o de otra plantilla: 404 CONTROL_NOT_FOUND', async () => {
    const auth = await as('manager')
    const id = await idOf('Una')
    const other = await idOf('Otra')
    const mine = (await add(id, { title: 'mio' })).list[0]!
    const foreign = (await add(other, { title: 'ajeno' })).list[0]!
    await api().patch(`${T}/${id}/controls/${mine.id}`).set('authorization', auth).send({}).expect(400)
    await api().patch(`${T}/${id}/controls/${mine.id}`).set('authorization', auth).send({ title: ' ' }).expect(400)
    for (const controlId of [UNKNOWN_ID, foreign.id]) {
      const res = await api().patch(`${T}/${id}/controls/${controlId}`).set('authorization', auth).send({ title: 'x' })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('CONTROL_NOT_FOUND')
    }
    expect(byTitle(await list(other), 'ajeno')).toBeDefined()
  })
})

describe('controles: mover', () => {
  const move = async (templateId: string, controlId: string, body: { parentId: string | null; position: number }) =>
    api()
      .post(`${T}/${templateId}/controls/${controlId}/move`)
      .set('authorization', await as('manager'))
      .send(body)

  it('subir y bajar entre hermanos renumera sin huecos', async () => {
    const id = await idOf()
    await seed(id, [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }])
    let l = await list(id)
    let res = await move(id, byTitle(l, 'd').id, { parentId: null, position: 0 })
    expect(res.status).toBe(200)
    expect(titles(res.body.data)).toEqual(['d', 'a', 'b', 'c'])
    l = res.body.data
    res = await move(id, byTitle(l, 'd').id, { parentId: null, position: 2 })
    expect(titles(res.body.data)).toEqual(['a', 'b', 'd', 'c'])
    expect(await dbPositions(id, null)).toEqual([
      ['a', 0],
      ['b', 1],
      ['d', 2],
      ['c', 3],
    ])
  })

  it('cambiar de padre: el grupo que deja queda sin huecos y el nuevo lo recibe en su lugar', async () => {
    const id = await idOf()
    await seed(id, [
      { title: 'P', kids: [{ title: 'p1' }, { title: 'p2' }, { title: 'p3' }] },
      { title: 'Q', kids: [{ title: 'q1' }, { title: 'q2' }] },
    ])
    const l = await list(id)
    const res = await move(id, byTitle(l, 'p2').id, { parentId: byTitle(l, 'Q').id, position: 1 })
    expect(res.status).toBe(200)
    expect(titles(res.body.data)).toEqual(['P', 'p1', 'p3', 'Q', 'q1', 'p2', 'q2'])
    expect(byTitle(res.body.data, 'p2')).toMatchObject({ depth: 1, parentId: byTitle(l, 'Q').id })
    expect(await dbPositions(id, byTitle(l, 'P').id)).toEqual([
      ['p1', 0],
      ['p3', 1],
    ])
    expect(await dbPositions(id, byTitle(l, 'Q').id)).toEqual([
      ['q1', 0],
      ['p2', 1],
      ['q2', 2],
    ])
  })

  it('llevar un dominio con toda su rama bajo otro dominio: la rama viaja y sus niveles se recalculan', async () => {
    const id = await idOf()
    await seed(id, [{ title: 'X', kids: [{ title: 'x1', kids: [{ title: 'x1a' }] }] }, { title: 'Y' }])
    const l = await list(id)
    const res = await move(id, byTitle(l, 'X').id, { parentId: byTitle(l, 'Y').id, position: 0 })
    expect(res.status).toBe(200)
    expect(res.body.data.map((v: View) => [v.title, v.depth])).toEqual([
      ['Y', 0],
      ['X', 1],
      ['x1', 2],
      ['x1a', 3],
    ])
    expect(byTitle(res.body.data, 'Y').isLeaf).toBe(false)
  })

  it('una hoja a primer nivel se vuelve dominio (parentId null)', async () => {
    const id = await idOf()
    await seed(id, [{ title: 'D', kids: [{ title: 'h' }] }])
    const l = await list(id)
    const res = await move(id, byTitle(l, 'h').id, { parentId: null, position: 1 })
    expect(res.body.data.map((v: View) => [v.title, v.depth])).toEqual([
      ['D', 0],
      ['h', 0],
    ])
  })

  it('mover bajo sí mismo o bajo un descendiente: 422 CONTROL_PARENT_INVALID (ciclo) y nada cambia', async () => {
    const id = await idOf()
    await seed(id, [{ title: 'A', kids: [{ title: 'B', kids: [{ title: 'C' }] }] }])
    const l = await list(id)
    const before = await db.control.findMany({ where: { templateId: id }, orderBy: { title: 'asc' } })
    for (const target of ['A', 'B', 'C']) {
      const res = await move(id, byTitle(l, 'A').id, { parentId: byTitle(l, target).id, position: 0 })
      expect(res.status).toBe(422)
      expect(res.body.error).toMatchObject({ code: 'CONTROL_PARENT_INVALID', details: { reason: 'CYCLE' } })
    }
    expect(await db.control.findMany({ where: { templateId: id }, orderBy: { title: 'asc' } })).toEqual(before)
  })

  it('padre de otra plantilla o inexistente: 422 NOT_IN_TEMPLATE; control inexistente: 404; posición inválida: 400', async () => {
    const id = await idOf('Una')
    const other = await idOf('Otra')
    await seed(id, [{ title: 'a' }])
    await seed(other, [{ title: 'ajeno' }])
    const mine = byTitle(await list(id), 'a')
    const foreign = byTitle(await list(other), 'ajeno')
    for (const parentId of [foreign.id, UNKNOWN_ID]) {
      const res = await move(id, mine.id, { parentId, position: 0 })
      expect(res.body.error).toMatchObject({ code: 'CONTROL_PARENT_INVALID', details: { reason: 'NOT_IN_TEMPLATE' } })
    }
    expect((await move(id, UNKNOWN_ID, { parentId: null, position: 0 })).body.error.code).toBe('CONTROL_NOT_FOUND')
    expect((await move(id, foreign.id, { parentId: null, position: 0 })).body.error.code).toBe('CONTROL_NOT_FOUND')
    expect((await move(id, mine.id, { parentId: null, position: -1 })).status).toBe(400)
    expect(byTitle(await list(other), 'ajeno').parentId).toBeNull()
  })

  it('mover una rama que excedería la profundidad máxima: 422 CONTROL_DEPTH_EXCEEDED', async () => {
    const id = await idOf()
    let parentId: string | null = null
    for (let level = 0; level < 9; level++) {
      const row: { id: string } = await db.control.create({
        data: { templateId: id, parentId, title: `n${level}`, position: 0 },
      })
      parentId = row.id
    }
    await seed(id, [{ title: 'rama', kids: [{ title: 'hijo' }] }])
    const rama = byTitle(await list(id), 'rama')
    const res = await move(id, rama.id, { parentId, position: 0 }) // rama quedaría en nivel 9 y su hijo en 10
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('CONTROL_DEPTH_EXCEEDED')
  })
})

describe('controles: eliminar', () => {
  const remove = async (templateId: string, controlId: string) =>
    api()
      .delete(`${T}/${templateId}/controls/${controlId}`)
      .set('authorization', await as('manager'))

  it('elimina una hoja y deja a los hermanos numerados sin huecos; devuelve la lista', async () => {
    const id = await idOf()
    await seed(id, [{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    const res = await remove(id, byTitle(await list(id), 'b').id)
    expect(res.status).toBe(200)
    expect(titles(res.body.data)).toEqual(['a', 'c'])
    expect(await dbPositions(id, null)).toEqual([
      ['a', 0],
      ['c', 1],
    ])
  })

  it('un control con hijos: 409 CONTROL_HAS_CHILDREN; primero sus hijos, luego él', async () => {
    const id = await idOf()
    await seed(id, [{ title: 'D', kids: [{ title: 'h' }] }])
    const l = await list(id)
    const res = await remove(id, byTitle(l, 'D').id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONTROL_HAS_CHILDREN')
    expect(await db.control.count()).toBe(2)
    await remove(id, byTitle(l, 'h').id)
    expect((await remove(id, byTitle(l, 'D').id)).body.data).toEqual([])
  })

  it('inexistente o de otra plantilla: 404', async () => {
    const id = await idOf('Una')
    const other = await idOf('Otra')
    await seed(other, [{ title: 'ajeno' }])
    const foreign = byTitle(await list(other), 'ajeno')
    expect((await remove(id, UNKNOWN_ID)).status).toBe(404)
    expect((await remove(id, foreign.id)).body.error.code).toBe('CONTROL_NOT_FOUND')
    expect(await db.control.count()).toBe(1)
  })
})

describe('una plantilla que no está en borrador es inmutable', () => {
  it.each(['PUBLISHED', 'ARCHIVED'] as const)(
    '%s: ninguna operación sobre sus controles pasa (409 TEMPLATE_NOT_EDITABLE)',
    async (status) => {
      const auth = await as('manager')
      const id = await idOf()
      await seed(id, [{ title: 'D', kids: [{ title: 'h' }] }])
      const l = await list(id)
      const D = byTitle(l, 'D')
      const h = byTitle(l, 'h')
      await db.template.update({ where: { id }, data: { status } })
      const before = await db.control.findMany({ where: { templateId: id }, orderBy: { title: 'asc' } })

      const calls = [
        () => api().post(`${T}/${id}/controls`).set('authorization', auth).send({ title: 'nuevo' }),
        () => api().patch(`${T}/${id}/controls/${h.id}`).set('authorization', auth).send({ title: 'cambio' }),
        () =>
          api()
            .post(`${T}/${id}/controls/${h.id}/move`)
            .set('authorization', auth)
            .send({ parentId: null, position: 0 }),
        () => api().delete(`${T}/${id}/controls/${h.id}`).set('authorization', auth),
        () => api().delete(`${T}/${id}/controls/${D.id}`).set('authorization', auth),
      ]
      for (const call of calls) {
        const res = await call()
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('TEMPLATE_NOT_EDITABLE')
      }
      expect(await db.control.findMany({ where: { templateId: id }, orderBy: { title: 'asc' } })).toEqual(before)
      // la lectura sigue funcionando
      expect(await list(id)).toHaveLength(2)
    },
  )
})

describe('bloqueo de la plantilla', () => {
  /**
   * Determinista: el test toma un bloqueo sobre la fila de la plantilla y comprueba que cada operación ESPERA. FOR NO
   * KEY UPDATE y no FOR UPDATE: insertar un control ya toma un bloqueo compartido de clave (por la FK) que también
   * chocaría con FOR UPDATE y taparía la ausencia del bloqueo propio (mismo criterio que en las escalas).
   */
  const operations: Array<
    [
      string,
      (templateId: string, controlId: string) => { method: 'post' | 'patch' | 'delete'; url: string; body?: object },
    ]
  > = [
    ['renombrar la plantilla', (id) => ({ method: 'patch', url: `${T}/${id}`, body: { name: 'Otro nombre' } })],
    ['eliminar la plantilla', (id) => ({ method: 'delete', url: `${T}/${id}` })],
    ['crear un control', (id) => ({ method: 'post', url: `${T}/${id}/controls`, body: { title: 'nuevo' } })],
    ['editar un control', (id, c) => ({ method: 'patch', url: `${T}/${id}/controls/${c}`, body: { title: 'otro' } })],
    [
      'mover un control',
      (id, c) => ({ method: 'post', url: `${T}/${id}/controls/${c}/move`, body: { parentId: null, position: 0 } }),
    ],
    ['eliminar un control', (id, c) => ({ method: 'delete', url: `${T}/${id}/controls/${c}` })],
  ]

  it.each(operations)('%s espera al bloqueo', async (_name, build) => {
    const auth = await as('manager')
    const id = await idOf()
    await seed(id, [{ title: 'h' }])
    const control = (await list(id))[0]!
    const { method, url, body } = build(id, control.id)

    let release!: () => void
    let taken!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const lockTaken = new Promise<void>((resolve) => (taken = resolve))
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "templates" WHERE "id" = ${id}::uuid FOR NO KEY UPDATE`
      taken()
      await gate
    })
    await lockTaken

    const call = method === 'post' ? api().post(url) : method === 'patch' ? api().patch(url) : api().delete(url)
    const pending = call
      .set('authorization', auth)
      .send(body)
      .then((response) => response)
    const early = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve('esperando'), 500))])
    expect(early).toBe('esperando')

    release()
    await holder
    expect((await pending).status).toBeLessThan(300)
  })

  it('altas simultáneas bajo el mismo padre: las posiciones quedan distintas y contiguas (humo; la garantía la fija el test anterior)', async () => {
    const id = await idOf()
    const auth = await as('manager')
    const results = await Promise.all(
      Array.from({ length: 6 }, (_v, i) =>
        api()
          .post(`${T}/${id}/controls`)
          .set('authorization', auth)
          .send({ title: `c${i}` }),
      ),
    )
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201])
    expect((await dbPositions(id, null)).map((p) => p[1])).toEqual([0, 1, 2, 3, 4, 5])
  })
})
