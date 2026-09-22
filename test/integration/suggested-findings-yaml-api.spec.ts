import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { useTestApi } from './support/api.js'
import { type SeedNode, seedControls } from './support/templates.js'

const T = '/api/v1/templates'
const YAML_MIME = 'application/yaml'
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
  { title: 'Personas', kids: [{ title: 'Selección', kids: [{ title: 'Antecedentes' }] }] },
]

async function setup(tree: readonly SeedNode[] = TREE) {
  const template = await db.template.create({ data: { name: 'ISO/IEC 27001:2022' } })
  await seedControls(db, template.id, tree)
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
  return {
    template,
    scale,
    controls,
    control: (title: string) => controls.find((c) => c.title === title)!,
    level: (label: string) => scale.levels.find((l) => l.label === label)!,
  }
}
type Ctx = Awaited<ReturnType<typeof setup>>
const base = (c: Ctx) => `${T}/${c.template.id}/suggested-findings`
const seedText = (c: Ctx, control: string, level: string, text: string) =>
  db.suggestedFinding.create({ data: { controlId: c.control(control).id, levelId: c.level(level).id, text } })

interface FindingEntry {
  id?: string | null
  domain?: string | null
  reference?: string | null
  control?: string | null
  texts?: Record<string, string>
}
interface MatrixDoc {
  findings: FindingEntry[]
}

async function download(c: Ctx, role: 'manager' | 'auditor' = 'manager', scaleId = c.scale.id) {
  return api()
    .get(`${base(c)}/export`)
    .query({ scaleId })
    .set('authorization', await as(role))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
}
async function upload(c: Ctx, file: Buffer | undefined, opts: { scaleId?: string; role?: 'manager' | 'auditor' } = {}) {
  let req = api()
    .post(`${base(c)}/import`)
    .query({ scaleId: opts.scaleId ?? c.scale.id })
    .set('authorization', await as(opts.role ?? 'manager'))
  if (file) req = req.attach('file', file, { filename: 'matriz.yaml', contentType: YAML_MIME })
  return req
}
/** Descarga la matriz, deja que `edit` la modifique y devuelve el archivo resultante (lo que haría una persona a mano). */
async function editedMatrix(c: Ctx, edit: (doc: MatrixDoc) => void): Promise<Buffer> {
  const doc = parseYaml((await download(c)).body.toString('utf8')) as MatrixDoc
  edit(doc)
  return Buffer.from(stringifyYaml(doc), 'utf8')
}
const entryOf = (doc: MatrixDoc, title: string): FindingEntry => doc.findings.find((f) => f.control === title)!
const HEADER = { 'No cumple': '0 – No cumple', Parcial: '50 – Parcial', Cumple: '100 – Cumple' } as const
const saved = async () =>
  (await db.suggestedFinding.findMany({ include: { control: true, level: true } }))
    .map((f) => [f.control.title, f.level.label, f.text])
    .sort()

describe('exportar la matriz', () => {
  it('un YAML con una entrada por hoja en orden de lectura, todas las claves de opción y solo los textos de esa escala', async () => {
    const c = await setup()
    const other = await db.scale.create({
      data: {
        name: 'Otra',
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
    await seedText(c, 'Políticas', 'Parcial', 'Falta aprobación')
    await db.suggestedFinding.create({
      data: { controlId: c.control('Roles').id, levelId: other.levels[0]!.id, text: 'de otra escala' },
    })

    const res = await download(c)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(YAML_MIME)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="ISO_IEC 27001_2022 - Conformidad\.yaml"; filename\*=UTF-8''/,
    )
    const doc = parseYaml((res.body as Buffer).toString('utf8')) as MatrixDoc
    expect(doc.findings.map((f) => [f.domain, f.reference, f.control])).toEqual([
      ['Organizacionales', 'A.5.1', 'Políticas'],
      ['Organizacionales', 'A.5.2', 'Roles'],
      ['Personas', null, 'Antecedentes'],
    ])
    expect(doc.findings[0]!.id).toBe(c.control('Políticas').id)
    expect(doc.findings.map((f) => f.texts)).toEqual([
      { [HEADER['No cumple']]: '', [HEADER.Parcial]: 'Falta aprobación', [HEADER.Cumple]: '' },
      { [HEADER['No cumple']]: '', [HEADER.Parcial]: '', [HEADER.Cumple]: '' },
      { [HEADER['No cumple']]: '', [HEADER.Parcial]: '', [HEADER.Cumple]: '' },
    ])
  })

  it('permisos y errores: un auditor descarga (lectura); sin token 401; escala o plantilla inexistentes 404; sin scaleId 400', async () => {
    const c = await setup()
    expect((await download(c, 'auditor')).status).toBe(200)
    expect(
      (
        await api()
          .get(`${base(c)}/export`)
          .query({ scaleId: c.scale.id })
      ).status,
    ).toBe(401)
    expect((await download(c, 'manager', UNKNOWN_ID)).status).toBe(404)
    expect(
      (
        await api()
          .get(`${T}/${UNKNOWN_ID}/suggested-findings/export`)
          .query({ scaleId: c.scale.id })
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(404)
    expect(
      (
        await api()
          .get(`${base(c)}/export`)
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(400)
  })
})

describe('importar la matriz', () => {
  it('subir la matriz recién descargada no cambia nada: todo "unchanged"', async () => {
    const c = await setup()
    await seedText(c, 'Políticas', 'Parcial', 'a')
    await seedText(c, 'Roles', 'Cumple', 'b')
    const res = await upload(c, (await download(c)).body as Buffer)
    expect(res.status).toBe(201)
    expect(res.body.data).toEqual({ created: 0, updated: 0, unchanged: 2, warnings: [] })
    expect(await db.suggestedFinding.count()).toBe(2)
  })

  it('completa la matriz: crea las celdas nuevas, actualiza las cambiadas y NO borra las que quedaron vacías', async () => {
    const c = await setup()
    await seedText(c, 'Políticas', 'Parcial', 'texto viejo')
    await seedText(c, 'Roles', 'Cumple', 'se conserva')
    const file = await editedMatrix(c, (doc) => {
      entryOf(doc, 'Políticas').texts![HEADER['No cumple']] = '  No existe la política.  '
      entryOf(doc, 'Políticas').texts![HEADER.Parcial] = 'texto nuevo'
      entryOf(doc, 'Roles').texts![HEADER.Cumple] = '' // vaciar la celda no borra
      entryOf(doc, 'Antecedentes').texts![HEADER['No cumple']] = 'Sin verificación de antecedentes.\nSegunda línea.'
    })
    const res = await upload(c, file)
    expect(res.status).toBe(201)
    expect(res.body.data).toEqual({ created: 2, updated: 1, unchanged: 0, warnings: [] })
    expect(await saved()).toEqual(
      [
        ['Políticas', 'No cumple', 'No existe la política.'],
        ['Políticas', 'Parcial', 'texto nuevo'],
        ['Roles', 'Cumple', 'se conserva'],
        ['Antecedentes', 'No cumple', 'Sin verificación de antecedentes.\nSegunda línea.'],
      ].sort(),
    )
  })

  it('reconoce las columnas por puntaje aunque se renombre la clave; una clave desconocida se ignora con aviso', async () => {
    const c = await setup()
    const file = await editedMatrix(c, (doc) => {
      for (const entry of doc.findings) {
        const value = entry.texts?.[HEADER.Parcial]
        if (value !== undefined) {
          entry.texts!['50 - Cumple en parte'] = value
          delete entry.texts![HEADER.Parcial]
        }
      }
      entryOf(doc, 'Roles').texts!['50 - Cumple en parte'] = 'texto'
      entryOf(doc, 'Roles').texts!['Comentarios'] = 'una nota'
    })
    const res = await upload(c, file)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ created: 1, warnings: [expect.stringMatching(/Comentarios/)] })
    expect(await saved()).toEqual([['Roles', 'Parcial', 'texto']])
  })

  it('se puede importar en una plantilla PUBLICADA (los textos se editan en cualquier estado)', async () => {
    const c = await setup()
    await db.template.update({ where: { id: c.template.id }, data: { status: 'PUBLISHED' } })
    const file = await editedMatrix(c, (doc) => (entryOf(doc, 'Roles').texts![HEADER.Cumple] = 'ok'))
    expect((await upload(c, file)).status).toBe(201)
    expect(await db.suggestedFinding.count()).toBe(1)
  })

  it('con errores: 422 con la posición de cada uno (orden de lectura) y NO se guarda NINGUNA celda (todo o nada)', async () => {
    const c = await setup()
    const file = await editedMatrix(c, (doc) => {
      entryOf(doc, 'Políticas').texts![HEADER['No cumple']] = 'esta sí es válida'
      entryOf(doc, 'Roles').id = c.control('Organizacionales').id // un agrupador
      entryOf(doc, 'Roles').texts![HEADER.Parcial] = 'texto'
      entryOf(doc, 'Antecedentes').id = UNKNOWN_ID // de ninguna plantilla
      entryOf(doc, 'Antecedentes').texts![HEADER.Parcial] = 'texto'
    })
    const res = await upload(c, file)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_IMPORT_INVALID')
    expect(res.body.error.details.errors.map((e: { row: number }) => e.row)).toEqual([2, 3])
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('una entrada con el mismo control repetido: error; un ID de otra plantilla: error', async () => {
    const c = await setup()
    const other = await db.template.create({ data: { name: 'Otra' } })
    await seedControls(db, other.id, [{ title: 'ajeno' }])
    const foreign = await db.control.findFirstOrThrow({ where: { templateId: other.id } })
    const file = await editedMatrix(c, (doc) => {
      entryOf(doc, 'Roles').id = c.control('Políticas').id
      entryOf(doc, 'Roles').texts![HEADER.Parcial] = 'x'
      entryOf(doc, 'Políticas').texts![HEADER.Parcial] = 'y'
      entryOf(doc, 'Antecedentes').id = foreign.id
      entryOf(doc, 'Antecedentes').texts![HEADER.Parcial] = 'z'
    })
    const res = await upload(c, file)
    expect(res.body.error.details.errors.map((e: { message: string }) => e.message)).toEqual([
      expect.stringMatching(/ya aparece en la fila 1/),
      expect.stringMatching(/no corresponde/),
    ])
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it.each([
    ['sin archivo', async () => undefined, /Falta el archivo/],
    ['un archivo que no es YAML', async () => Buffer.from('findings: [x: y: z\n', 'utf8'), /no es un YAML válido/],
    [
      'sin ID en ninguna entrada',
      async () => Buffer.from('findings:\n  - control: x\n    texts:\n      0 – No cumple: "y"\n', 'utf8'),
      /Falta el ID/,
    ],
    [
      'sin ninguna columna de opción de esta escala',
      async () =>
        Buffer.from(
          'findings:\n  - id: 0199c0de-0000-7000-8000-000000000099\n    texts:\n      7 – Otra: "y"\n',
          'utf8',
        ),
      /ninguna columna de opción/,
    ],
  ])('%s: 422 y no se guarda nada', async (_caso, make, message) => {
    const c = await setup()
    const res = await upload(c, await make())
    expect(res.status).toBe(422)
    expect(res.body.error.details.errors[0].message).toMatch(message)
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('un archivo de más de 5 MB: 413; un auditor no importa (403); sin token 401; escala o plantilla inexistentes 404', async () => {
    const c = await setup()
    expect((await upload(c, Buffer.alloc(5 * 1024 * 1024 + 1024, 'a'))).status).toBe(413)
    const file = (await download(c)).body as Buffer
    expect((await upload(c, file, { role: 'auditor' })).status).toBe(403)
    expect(
      (
        await api()
          .post(`${base(c)}/import`)
          .query({ scaleId: c.scale.id })
          .attach('file', file, 'x.yaml')
      ).status,
    ).toBe(401)
    expect((await upload(c, file, { scaleId: UNKNOWN_ID })).body.error.code).toBe('SCALE_NOT_FOUND')
    const missing = await api()
      .post(`${T}/${UNKNOWN_ID}/suggested-findings/import`)
      .query({ scaleId: c.scale.id })
      .set('authorization', await as('manager'))
      .attach('file', file, 'x.yaml')
    expect(missing.body.error.code).toBe('TEMPLATE_NOT_FOUND')
  })

  it('una matriz grande (300 controles × 5 opciones): crea 1500 y luego actualiza 1500 con un número fijo de sentencias', async () => {
    const c0 = await setup([])
    const tree = Array.from({ length: 10 }, (_v, d) => ({
      title: `D${d}`,
      kids: Array.from({ length: 30 }, (_w, k) => ({ title: `D${d}.C${k}` })),
    }))
    await seedControls(db, c0.template.id, tree)
    const scale = await db.scale.create({
      data: {
        name: 'Cinco',
        dimension: 'MATURITY',
        levels: { create: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: `Nivel ${v}` })) },
      },
      include: { levels: { orderBy: { value: 'asc' } } },
    })
    const c: Ctx = {
      ...c0,
      scale,
      level: (label: string) => scale.levels.find((l) => l.label === label)!,
    } as unknown as Ctx
    const headers = scale.levels.map((l) => `${l.value.toNumber()} – ${l.label}`)

    const first = await editedMatrix(c, (doc) => {
      doc.findings.forEach((entry, n) => {
        for (const header of headers) entry.texts![header] = `texto ${n}`
      })
    })
    const created = await upload(c, first)
    expect(created.body.data).toMatchObject({ created: 1500, updated: 0, unchanged: 0 })
    expect(await db.suggestedFinding.count()).toBe(1500)

    const second = await editedMatrix(c, (doc) => {
      doc.findings.forEach((entry, n) => {
        for (const header of headers) entry.texts![header] = `cambiado ${n}`
      })
    })
    const updated = await upload(c, second)
    expect(updated.body.data).toMatchObject({ created: 0, updated: 1500, unchanged: 0 })
    expect((await db.suggestedFinding.findMany({ where: { text: { startsWith: 'cambiado ' } } })).length).toBe(1500)
  })

  it('atomicidad: si falla una actualización, tampoco quedan las celdas nuevas que ya se habían creado', async () => {
    const c = await setup()
    await seedText(c, 'Roles', 'Cumple', 'viejo')
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_update() RETURNS trigger AS $$
      BEGIN IF NEW."text" = 'BOOM' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_update BEFORE UPDATE ON "suggested_findings" FOR EACH ROW EXECUTE FUNCTION test_fail_update()`,
    )
    try {
      const file = await editedMatrix(c, (doc) => {
        entryOf(doc, 'Políticas').texts![HEADER.Parcial] = 'nueva (se crea antes de fallar)'
        entryOf(doc, 'Roles').texts![HEADER.Cumple] = 'BOOM'
      })
      const res = await upload(c, file)
      expect(res.status).toBe(500)
      expect(await saved()).toEqual([['Roles', 'Cumple', 'viejo']])
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_fail_update ON "suggested_findings"')
      await db.$executeRawUnsafe('DROP FUNCTION test_fail_update()')
    }
  })
})
