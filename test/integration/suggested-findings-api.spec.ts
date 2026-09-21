import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { listRoutes } from '../../src/platform/authz/index.js'
import { useTestApi } from './support/api.js'
import { type SeedNode, seedControls } from './support/templates.js'

const T = '/api/v1/templates'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

const TREE: SeedNode[] = [
  {
    title: 'Organizacionales',
    reference: 'A.5',
    kids: [
      { title: 'Políticas', reference: 'A.5.1' },
      { title: 'Roles', reference: 'A.5.2' },
    ],
  },
  { title: 'Personas', reference: 'A.6', kids: [{ title: 'Selección', kids: [{ title: 'Antecedentes' }] }] },
]

async function setup() {
  const template = await db.template.create({ data: { name: 'ISO/IEC 27001:2022' } })
  await seedControls(db, template.id, TREE)
  const scale = await db.scale.create({
    data: {
      name: 'Conformidad',
      dimension: 'CONFORMITY',
      levels: {
        create: [
          { value: 0, label: 'No cumple' },
          { value: 50, label: 'Parcial' },
          { value: 100, label: 'Cumple' },
        ],
      },
    },
    include: { levels: { orderBy: { value: 'asc' } } },
  })
  const controls = await db.control.findMany({ where: { templateId: template.id } })
  const control = (title: string) => controls.find((c) => c.title === title)!
  const level = (label: string) => scale.levels.find((l) => l.label === label)!
  return { template, scale, control, level }
}
type Ctx = Awaited<ReturnType<typeof setup>>
const url = (c: Ctx, control: string, level: string) =>
  `${T}/${c.template.id}/controls/${c.control(control).id}/suggested-findings/${c.level(level).id}`
const put = async (path: string, text: unknown, role: 'manager' | 'auditor' = 'manager') =>
  api()
    .put(path)
    .set('authorization', await as(role))
    .send({ text })
const del = async (path: string, role: 'manager' | 'auditor' = 'manager') =>
  api()
    .delete(path)
    .set('authorization', await as(role))
const matrix = async (c: Ctx, scaleId = c.scale.id, role: 'manager' | 'auditor' = 'manager') =>
  api()
    .get(`${T}/${c.template.id}/suggested-findings`)
    .query({ scaleId })
    .set('authorization', await as(role))

describe('permisos', () => {
  it('sin token 401; un auditor lee la matriz pero no escribe ni borra (403)', async () => {
    const c = await setup()
    await api().get(`${T}/${c.template.id}/suggested-findings`).query({ scaleId: c.scale.id }).expect(401)
    expect((await matrix(c, c.scale.id, 'auditor')).status).toBe(200)
    expect((await put(url(c, 'Políticas', 'Parcial'), 'x', 'auditor')).status).toBe(403)
    expect((await del(url(c, 'Políticas', 'Parcial'), 'auditor')).status).toBe(403)
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('cada endpoint declara la acción que le corresponde', () => {
    const declared = listRoutes(t.app().get(DiscoveryService), t.app().get(MetadataScanner), t.app().get(Reflector))
      .filter((r) => r.handler.startsWith('SuggestedFindingsController.'))
      .map(
        (r) =>
          `${r.method} ${r.path} → ${r.access?.kind === 'can' ? `${r.access.action} ${r.access.subject}` : r.access?.kind}`,
      )
      .sort()
    expect(declared).toEqual(
      [
        'GET /templates/:templateId/suggested-findings → read Template',
        'GET /templates/:templateId/suggested-findings/export → read Template',
        'POST /templates/:templateId/suggested-findings/import → update Template',
        'PUT /templates/:templateId/controls/:controlId/suggested-findings/:levelId → update Template',
        'DELETE /templates/:templateId/controls/:controlId/suggested-findings/:levelId → update Template',
      ].sort(),
    )
  })
})

describe('matriz', () => {
  it('una fila por hoja en orden de lectura, con su dominio; sin filas para los agrupadores; los huecos no existen', async () => {
    const c = await setup()
    const res = await matrix(c)
    expect(res.status).toBe(200)
    expect(res.body.data.scale).toMatchObject({ id: c.scale.id, name: 'Conformidad' })
    expect(res.body.data.scale.levels.map((l: { value: number; label: string }) => [l.value, l.label])).toEqual([
      [0, 'No cumple'],
      [50, 'Parcial'],
      [100, 'Cumple'],
    ])
    expect(
      res.body.data.controls.map((x: { title: string; domain: string; reference: string | null }) => [
        x.title,
        x.domain,
        x.reference,
      ]),
    ).toEqual([
      ['Políticas', 'Organizacionales', 'A.5.1'],
      ['Roles', 'Organizacionales', 'A.5.2'],
      ['Antecedentes', 'Personas', null],
    ])
    expect(res.body.data.controls.every((x: { texts: unknown[] }) => x.texts.length === 0)).toBe(true)
  })

  it('devuelve solo los textos de las opciones de LA ESCALA pedida', async () => {
    const c = await setup()
    const other = await db.scale.create({
      data: {
        name: 'Madurez',
        dimension: 'MATURITY',
        levels: {
          create: [
            { value: 0, label: 'a' },
            { value: 1, label: 'b' },
          ],
        },
      },
      include: { levels: true },
    })
    await put(url(c, 'Políticas', 'Parcial'), 'Falta aprobación')
    await api()
      .put(`${T}/${c.template.id}/controls/${c.control('Roles').id}/suggested-findings/${other.levels[0]!.id}`)
      .set('authorization', await as('manager'))
      .send({ text: 'de la otra escala' })

    const mine = (await matrix(c)).body.data.controls
    expect(mine.find((x: { title: string }) => x.title === 'Políticas').texts).toEqual([
      { levelId: c.level('Parcial').id, text: 'Falta aprobación' },
    ])
    expect(mine.find((x: { title: string }) => x.title === 'Roles').texts).toEqual([])
    const theirs = (await matrix(c, other.id)).body.data.controls
    expect(theirs.find((x: { title: string }) => x.title === 'Roles').texts).toEqual([
      { levelId: other.levels[0]!.id, text: 'de la otra escala' },
    ])
  })

  it('plantilla o escala inexistentes: 404; sin scaleId o mal formado: 400', async () => {
    const c = await setup()
    const auth = await as('manager')
    const noTemplate = await api()
      .get(`${T}/${UNKNOWN_ID}/suggested-findings`)
      .query({ scaleId: c.scale.id })
      .set('authorization', auth)
    expect(noTemplate.body.error.code).toBe('TEMPLATE_NOT_FOUND')
    expect((await matrix(c, UNKNOWN_ID)).body.error.code).toBe('SCALE_NOT_FOUND')
    await api().get(`${T}/${c.template.id}/suggested-findings`).set('authorization', auth).expect(400)
    await api()
      .get(`${T}/${c.template.id}/suggested-findings`)
      .query({ scaleId: 'x' })
      .set('authorization', auth)
      .expect(400)
  })
})

describe('escribir y quitar', () => {
  it('PUT crea y luego reemplaza (upsert); recorta el texto; una sola fila por (control, opción)', async () => {
    const c = await setup()
    const first = await put(url(c, 'Políticas', 'No cumple'), '  No existe una política aprobada.  ')
    expect(first.status).toBe(200)
    expect(first.body.data).toEqual({
      controlId: c.control('Políticas').id,
      levelId: c.level('No cumple').id,
      text: 'No existe una política aprobada.',
    })
    const second = await put(url(c, 'Políticas', 'No cumple'), 'Texto nuevo')
    expect(second.body.data.text).toBe('Texto nuevo')
    expect(await db.suggestedFinding.count()).toBe(1)
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['no es texto', 5],
    ['demasiado largo', 'x'.repeat(20001)],
  ])('texto %s: 400 y no se guarda', async (_c, text) => {
    const c = await setup()
    expect((await put(url(c, 'Roles', 'Cumple'), text)).status).toBe(400)
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('solo las hojas admiten sugerencias: un agrupador da 422 SUGGESTED_FINDING_CONTROL_NOT_LEAF', async () => {
    const c = await setup()
    for (const group of ['Organizacionales', 'Selección']) {
      const res = await put(url(c, group, 'Cumple'), 'x')
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('SUGGESTED_FINDING_CONTROL_NOT_LEAF')
    }
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('control de otra plantilla o inexistente: 404 CONTROL_NOT_FOUND; opción inexistente: 404 SCALE_LEVEL_NOT_FOUND; plantilla inexistente 404', async () => {
    const c = await setup()
    const other = await db.template.create({ data: { name: 'Otra' } })
    await seedControls(db, other.id, [{ title: 'ajeno' }])
    const foreign = await db.control.findFirstOrThrow({ where: { templateId: other.id } })
    const base = `${T}/${c.template.id}/controls`
    expect((await put(`${base}/${foreign.id}/suggested-findings/${c.level('Cumple').id}`, 'x')).body.error.code).toBe(
      'CONTROL_NOT_FOUND',
    )
    expect((await put(`${base}/${UNKNOWN_ID}/suggested-findings/${c.level('Cumple').id}`, 'x')).body.error.code).toBe(
      'CONTROL_NOT_FOUND',
    )
    expect((await put(`${base}/${c.control('Roles').id}/suggested-findings/${UNKNOWN_ID}`, 'x')).body.error.code).toBe(
      'SCALE_LEVEL_NOT_FOUND',
    )
    expect(
      (
        await put(
          `${T}/${UNKNOWN_ID}/controls/${c.control('Roles').id}/suggested-findings/${c.level('Cumple').id}`,
          'x',
        )
      ).status,
    ).toBe(404)
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('se puede escribir y corregir en CUALQUIER estado de la plantilla (el texto se copia al usarse, no queda vínculo)', async () => {
    const c = await setup()
    for (const status of ['PUBLISHED', 'ARCHIVED'] as const) {
      await db.template.update({ where: { id: c.template.id }, data: { status } })
      expect((await put(url(c, 'Roles', 'Parcial'), `texto en ${status}`)).status).toBe(200)
    }
    expect((await matrix(c)).body.data.controls.find((x: { title: string }) => x.title === 'Roles').texts[0].text).toBe(
      'texto en ARCHIVED',
    )
  })

  it('DELETE quita la sugerencia (204) y es idempotente; una de otra plantilla no se toca', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'x')
    expect((await del(url(c, 'Roles', 'Parcial'))).status).toBe(204)
    expect(await db.suggestedFinding.count()).toBe(0)
    expect((await del(url(c, 'Roles', 'Parcial'))).status).toBe(204)

    const other = await db.template.create({ data: { name: 'Otra' } })
    await seedControls(db, other.id, [{ title: 'ajeno' }])
    const foreign = await db.control.findFirstOrThrow({ where: { templateId: other.id } })
    await db.suggestedFinding.create({ data: { controlId: foreign.id, levelId: c.level('Cumple').id, text: 'ajena' } })
    await del(`${T}/${c.template.id}/controls/${foreign.id}/suggested-findings/${c.level('Cumple').id}`)
    expect(await db.suggestedFinding.count()).toBe(1)
  })
})

describe('el árbol cambia debajo de los textos', () => {
  it('si una hoja pasa a ser agrupadora sus textos no se pierden: se dejan de mostrar y reaparecen al quitarle los hijos', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'Texto de cuando era hoja')
    const auth = await as('manager')
    const added = await api()
      .post(`${T}/${c.template.id}/controls`)
      .set('authorization', auth)
      .send({ title: 'Sub-rol', parentId: c.control('Roles').id })
    expect(added.status).toBe(201)

    const during = (await matrix(c)).body.data.controls.map((x: { title: string }) => x.title)
    expect(during).toEqual(['Políticas', 'Sub-rol', 'Antecedentes'])
    expect(await db.suggestedFinding.count()).toBe(1)

    const child = added.body.data.find((x: { title: string }) => x.title === 'Sub-rol')
    await api().delete(`${T}/${c.template.id}/controls/${child.id}`).set('authorization', auth).expect(200)
    const after = (await matrix(c)).body.data.controls.find((x: { title: string }) => x.title === 'Roles')
    expect(after.texts).toEqual([{ levelId: c.level('Parcial').id, text: 'Texto de cuando era hoja' }])
  })

  it('eliminar el control o la plantilla borra sus sugerencias', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'a')
    await put(url(c, 'Políticas', 'Cumple'), 'b')
    await api()
      .delete(`${T}/${c.template.id}/controls/${c.control('Roles').id}`)
      .set('authorization', await as('manager'))
      .expect(200)
    expect(await db.suggestedFinding.count()).toBe(1)
    await api()
      .delete(`${T}/${c.template.id}`)
      .set('authorization', await as('manager'))
      .expect(204)
    expect(await db.suggestedFinding.count()).toBe(0)
  })
})

describe('una escala con hallazgos sugeridos no pierde textos en silencio', () => {
  const SCALES = '/api/v1/scales'

  it('quitar una opción con sugerencias: 409 SCALE_LEVEL_IN_USE; sin sugerencias sí se puede', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'texto')
    const auth = await as('manager')
    const blocked = await api()
      .delete(`${SCALES}/${c.scale.id}/levels/${c.level('Parcial').id}`)
      .set('authorization', auth)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toMatchObject({
      code: 'SCALE_LEVEL_IN_USE',
      details: { reason: 'SUGGESTED_FINDINGS', findings: 1 },
    })
    expect(await db.suggestedFinding.count()).toBe(1)
    await api()
      .delete(`${SCALES}/${c.scale.id}/levels/${c.level('No cumple').id}`)
      .set('authorization', auth)
      .expect(200)
  })

  it('borrar la escala con sugerencias: 409 SCALE_IN_USE y no se pierde nada; al quitar las sugerencias se puede', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'texto')
    const auth = await as('manager')
    const blocked = await api().delete(`${SCALES}/${c.scale.id}`).set('authorization', auth)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toMatchObject({ code: 'SCALE_IN_USE', details: { reason: 'SUGGESTED_FINDINGS' } })
    expect(await db.scale.count()).toBe(1)
    expect(await db.suggestedFinding.count()).toBe(1)
    await del(url(c, 'Roles', 'Parcial'))
    await api().delete(`${SCALES}/${c.scale.id}`).set('authorization', auth).expect(204)
  })

  it('cambiar el puntaje o la etiqueta de una opción con sugerencias sí se puede (el texto va por id, no por puntaje)', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'texto')
    await api()
      .patch(`${SCALES}/${c.scale.id}/levels/${c.level('Parcial').id}`)
      .set('authorization', await as('manager'))
      .send({ value: 60, label: 'Cumple en parte' })
      .expect(200)
    const texts = (await matrix(c)).body.data.controls.find((x: { title: string }) => x.title === 'Roles').texts
    expect(texts).toEqual([{ levelId: c.level('Parcial').id, text: 'texto' }])
  })

  it('el respaldo de la BD: una FK restrictiva protege aunque el caso de uso no lo comprobara', async () => {
    const c = await setup()
    await put(url(c, 'Roles', 'Parcial'), 'texto')
    await expect(db.scaleLevel.delete({ where: { id: c.level('Parcial').id } })).rejects.toMatchObject({
      code: 'SCALE_LEVEL_IN_USE',
    })
    expect(await db.suggestedFinding.count()).toBe(1)
  })
})

describe('bloqueo de la plantilla', () => {
  /** Igual que en escalas y controles: se toma un bloqueo más débil que el propio (FOR NO KEY UPDATE) y la operación debe esperar. */
  it.each([
    ['escribir', 'put'],
    ['quitar', 'delete'],
  ] as const)('%s una sugerencia espera al bloqueo de la plantilla', async (_name, method) => {
    const c = await setup()
    const auth = await as('manager')
    let release!: () => void
    let taken!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const lockTaken = new Promise<void>((resolve) => (taken = resolve))
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "templates" WHERE "id" = ${c.template.id}::uuid FOR NO KEY UPDATE`
      taken()
      await gate
    })
    await lockTaken

    const call =
      method === 'put'
        ? api()
            .put(url(c, 'Roles', 'Parcial'))
            .send({ text: 'x' })
        : api().delete(url(c, 'Roles', 'Parcial'))
    const pending = call.set('authorization', auth).then((response) => response)
    const early = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve('esperando'), 500))])
    expect(early).toBe('esperando')
    release()
    await holder
    expect((await pending).status).toBeLessThan(300)
  })

  it('escrituras simultáneas de la misma sugerencia: todas 200 y queda una sola fila (nunca 409/500)', async () => {
    const c = await setup()
    const auth = await as('manager')
    const results = await Promise.all(
      Array.from({ length: 6 }, (_v, i) =>
        api()
          .put(url(c, 'Roles', 'Parcial'))
          .set('authorization', auth)
          .send({ text: `v${i}` }),
      ),
    )
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200])
    expect(await db.suggestedFinding.count()).toBe(1)
  })
})
