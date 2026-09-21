import { describe, expect, it } from 'vitest'
import { useTestApi } from './support/api.js'
import { type SeedNode, seedControls } from './support/templates.js'

const T = '/api/v1/templates'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

const TREE: SeedNode[] = [
  {
    title: 'A.5 Organizacionales',
    reference: 'A.5',
    description: 'Tema',
    kids: [
      { title: 'Políticas', reference: 'A.5.1' },
      {
        title: 'Roles',
        kids: [
          { title: 'Líder', reference: 'a)' },
          { title: 'Suplente', reference: 'a)' },
        ],
      },
    ],
  },
  {
    title: 'APO',
    kids: [
      {
        title: 'APO01',
        kids: [{ title: 'APO01.01', kids: [{ title: 'Actividad', description: 'Línea 1\nLínea 2' }] }],
      },
    ],
  },
]

async function source(name = 'Original', status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED') {
  const template = await db.template.create({ data: { name, status } })
  await seedControls(db, template.id, TREE)
  return template
}
const clone = async (id: string, name: unknown, role: 'manager' | 'auditor' = 'manager') =>
  api()
    .post(`${T}/${id}/clone`)
    .set('authorization', await as(role))
    .send({ name })
const shape = async (templateId: string) =>
  (
    (
      await api()
        .get(`${T}/${templateId}/controls`)
        .set('authorization', await as('manager'))
    ).body.data as Array<Record<string, unknown>>
  ).map(({ reference, title, description, position, depth, isLeaf }) => ({
    reference,
    title,
    description,
    position,
    depth,
    isLeaf,
  }))

describe('clonar', () => {
  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
    'clona una plantilla %s: nueva, en borrador, con el mismo árbol, orden y textos',
    async (status) => {
      const original = await source('Original', status)
      const res = await clone(original.id, '  Original v2  ')
      expect(res.status).toBe(201)
      expect(res.body.data).toMatchObject({
        name: 'Original v2',
        status: 'DRAFT',
        controlCount: 9,
        allowedActions: ['PUBLISH'],
      })
      expect(res.body.data.id).not.toBe(original.id)
      expect(await shape(res.body.data.id)).toEqual(await shape(original.id))
    },
  )

  it('el origen NO cambia: sigue en su estado (no se archiva) y con los mismos controles e ids', async () => {
    const original = await source('Original', 'PUBLISHED')
    const before = await db.control.findMany({ where: { templateId: original.id }, orderBy: { id: 'asc' } })
    await clone(original.id, 'Copia')
    expect((await db.template.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('PUBLISHED')
    expect(await db.control.findMany({ where: { templateId: original.id }, orderBy: { id: 'asc' } })).toEqual(before)
  })

  it('los controles de la copia son NUEVOS (ids distintos) y su árbol apunta a la copia, nunca al origen', async () => {
    const original = await source()
    const res = await clone(original.id, 'Copia')
    const originalIds = new Set((await db.control.findMany({ where: { templateId: original.id } })).map((c) => c.id))
    const copied = await db.control.findMany({ where: { templateId: res.body.data.id } })
    expect(copied).toHaveLength(originalIds.size)
    expect(copied.every((c) => !originalIds.has(c.id))).toBe(true)
    const copiedIds = new Set(copied.map((c) => c.id))
    expect(copied.every((c) => c.parentId === null || copiedIds.has(c.parentId))).toBe(true)
  })

  it('copia también los hallazgos sugeridos (mismas opciones, mismo texto), incluidos los de una hoja que hoy es agrupadora', async () => {
    const original = await source()
    const scale = await db.scale.create({
      data: {
        name: 'Conformidad',
        dimension: 'CONFORMITY',
        levels: {
          create: [
            { value: 0, label: 'No' },
            { value: 1, label: 'Sí' },
          ],
        },
      },
      include: { levels: true },
    })
    const controls = await db.control.findMany({ where: { templateId: original.id } })
    const by = (title: string) => controls.find((c) => c.title === title)!
    await db.suggestedFinding.createMany({
      data: [
        { controlId: by('Políticas').id, levelId: scale.levels[0]!.id, text: 'Falta la política' },
        { controlId: by('Líder').id, levelId: scale.levels[1]!.id, text: 'Líder definido' },
        { controlId: by('Roles').id, levelId: scale.levels[0]!.id, text: 'de cuando Roles era hoja' },
      ],
    })
    const res = await clone(original.id, 'Copia')
    const copied = await db.suggestedFinding.findMany({
      where: { control: { templateId: res.body.data.id } },
      include: { control: true },
    })
    expect(copied.map((f) => [f.control.title, f.levelId, f.text]).sort()).toEqual(
      [
        ['Políticas', scale.levels[0]!.id, 'Falta la política'],
        ['Líder', scale.levels[1]!.id, 'Líder definido'],
        ['Roles', scale.levels[0]!.id, 'de cuando Roles era hoja'],
      ].sort(),
    )
    expect(await db.suggestedFinding.count()).toBe(6)
    const view = (
      await api()
        .get(`${T}/${res.body.data.id}/suggested-findings`)
        .query({ scaleId: scale.id })
        .set('authorization', await as('manager'))
    ).body.data
    expect(view.controls.find((x: { title: string }) => x.title === 'Políticas').texts).toEqual([
      { levelId: scale.levels[0]!.id, text: 'Falta la política' },
    ])
  })

  it('copia y origen son independientes: editar una no toca la otra', async () => {
    const original = await source('Original', 'DRAFT')
    const res = await clone(original.id, 'Copia')
    const auth = await as('manager')
    await api()
      .post(`${T}/${res.body.data.id}/controls`)
      .set('authorization', auth)
      .send({ title: 'solo en la copia' })
      .expect(201)
    const originalControl = await db.control.findFirstOrThrow({
      where: { templateId: original.id, title: 'Políticas' },
    })
    await api()
      .patch(`${T}/${original.id}/controls/${originalControl.id}`)
      .set('authorization', auth)
      .send({ title: 'cambiado en el origen' })
      .expect(200)
    expect((await shape(original.id)).map((c) => c.title)).not.toContain('solo en la copia')
    expect((await shape(res.body.data.id)).map((c) => c.title)).toContain('Políticas')
  })

  it('una plantilla vacía se clona vacía', async () => {
    const empty = await db.template.create({ data: { name: 'Vacía' } })
    const res = await clone(empty.id, 'Copia vacía')
    expect(res.status).toBe(201)
    expect(res.body.data.controlCount).toBe(0)
  })

  it('el nombre de la copia no puede repetir el de otra plantilla (sin distinguir mayúsculas): 409 y no queda nada a medias', async () => {
    const original = await source('Original')
    const res = await clone(original.id, 'original')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TEMPLATE_NAME_TAKEN')
    expect(await db.template.count()).toBe(1)
    expect(await db.control.count()).toBe(9)
  })

  it.each([
    ['sin nombre', undefined],
    ['vacío', '  '],
    ['demasiado largo', 'x'.repeat(201)],
  ])('nombre %s: 400', async (_c, name) => {
    const original = await source()
    expect((await clone(original.id, name)).status).toBe(400)
    expect(await db.template.count()).toBe(1)
  })

  it('un auditor no clona (403); plantilla inexistente 404; sin token 401', async () => {
    const original = await source()
    expect((await clone(original.id, 'X', 'auditor')).status).toBe(403)
    expect((await clone(UNKNOWN_ID, 'X')).body.error.code).toBe('TEMPLATE_NOT_FOUND')
    expect((await api().post(`${T}/${original.id}/clone`).send({ name: 'X' })).status).toBe(401)
    expect(await db.template.count()).toBe(1)
  })

  it('la copia de una plantilla publicable también se puede publicar (mismo árbol)', async () => {
    const original = await source('Original', 'DRAFT')
    const res = await clone(original.id, 'Copia')
    expect(
      (
        await api()
          .post(`${T}/${res.body.data.id}/publish`)
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(200)
  })

  it('una plantilla grande (~2000 controles) se clona completa', async () => {
    const original = await db.template.create({ data: { name: 'Grande' } })
    const domains = Array.from({ length: 20 }, (_v, d) => ({
      title: `D${d}`,
      kids: Array.from({ length: 10 }, (_w, o) => ({
        title: `D${d}.O${o}`,
        kids: Array.from({ length: 9 }, (_x, c) => ({ title: `D${d}.O${o}.C${c}` })),
      })),
    }))
    await seedControls(db, original.id, domains)
    const res = await clone(original.id, 'Grande copia')
    expect(res.status).toBe(201)
    expect(res.body.data.controlCount).toBe(20 + 200 + 1800)
    const first = await shape(original.id)
    expect(await shape(res.body.data.id)).toEqual(first)
  })

  it('atomicidad: si falla el guardado de la copia, no queda ninguna plantilla ni control huérfanos', async () => {
    const original = await source()
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_control() RETURNS trigger AS $$
      BEGIN IF NEW."title" = 'Actividad' AND NEW."templateId" <> '${original.id}'::uuid THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_control BEFORE INSERT ON "controls" FOR EACH ROW EXECUTE FUNCTION test_fail_control()`,
    )
    try {
      const res = await clone(original.id, 'Se rompe')
      expect(res.status).toBe(500)
      expect(await db.template.count()).toBe(1)
      expect(await db.control.count()).toBe(9)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_fail_control ON "controls"')
      await db.$executeRawUnsafe('DROP FUNCTION test_fail_control()')
    }
  })
})
