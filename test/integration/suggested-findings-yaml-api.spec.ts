import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { useTestApi } from './support/api.js'
import { type SeedNode, seedControls } from './support/templates.js'

const T = '/api/v1/templates'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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
  if (file) req = req.attach('file', file, { filename: 'matriz.xlsx', contentType: XLSX })
  return req
}
async function sheetOf(buffer: Buffer): Promise<{ workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet }> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  return { workbook, sheet: workbook.getWorksheet('Hallazgos')! }
}
/** Descarga la matriz, deja que `edit` la modifique y devuelve el archivo resultante (lo que haría una persona en Excel). */
async function editedMatrix(c: Ctx, edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const { workbook, sheet } = await sheetOf((await download(c)).body as Buffer)
  edit(sheet)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
/** Fila de la hoja (2..) de un control, por su título en la columna "Control" (4). */
const rowOf = (sheet: ExcelJS.Worksheet, title: string): ExcelJS.Row => {
  let found: ExcelJS.Row | undefined
  sheet.eachRow((row) => {
    if (row.getCell(4).value === title) found = row
  })
  return found!
}
const COL = { 'No cumple': 5, Parcial: 6, Cumple: 7 } as const
const saved = async () =>
  (await db.suggestedFinding.findMany({ include: { control: true, level: true } }))
    .map((f) => [f.control.title, f.level.label, f.text])
    .sort()

describe('exportar la matriz', () => {
  it('un .xlsx con una fila por hoja en orden de lectura, una columna por opción y solo los textos de esa escala', async () => {
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
    expect(res.headers['content-type']).toBe(XLSX)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="ISO_IEC 27001_2022 - Conformidad\.xlsx"; filename\*=UTF-8''/,
    )
    const { sheet } = await sheetOf(res.body as Buffer)
    expect(sheet.getColumn(1).hidden).toBe(true)
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'ID',
      'Dominio',
      'Referencia',
      'Control',
      '0 – No cumple',
      '50 – Parcial',
      '100 – Cumple',
    ])
    const rows = (sheet.getSheetValues().slice(2) as Array<Array<ExcelJS.CellValue>>).map((r) => [
      r[1],
      r[2],
      r[3] || null,
      r[4],
      r[5] || null,
      r[6] || null,
      r[7] || null,
    ])
    expect(rows).toEqual([
      [c.control('Políticas').id, 'Organizacionales', 'A.5.1', 'Políticas', null, 'Falta aprobación', null],
      [c.control('Roles').id, 'Organizacionales', 'A.5.2', 'Roles', null, null, null],
      [c.control('Antecedentes').id, 'Personas', null, 'Antecedentes', null, null, null],
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
    const file = await editedMatrix(c, (sheet) => {
      rowOf(sheet, 'Políticas').getCell(COL['No cumple']).value = '  No existe la política.  '
      rowOf(sheet, 'Políticas').getCell(COL.Parcial).value = 'texto nuevo'
      rowOf(sheet, 'Roles').getCell(COL.Cumple).value = null // vaciar la celda no borra
      rowOf(sheet, 'Antecedentes').getCell(COL['No cumple']).value = 'Sin verificación de antecedentes.\nSegunda línea.'
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

  it('reconoce las columnas por puntaje aunque se cambie la etiqueta de la cabecera; una columna desconocida se ignora con aviso', async () => {
    const c = await setup()
    const file = await editedMatrix(c, (sheet) => {
      sheet.getRow(1).getCell(COL.Parcial).value = '50 - Cumple en parte'
      sheet.getRow(1).getCell(8).value = 'Comentarios'
      rowOf(sheet, 'Roles').getCell(COL.Parcial).value = 'texto'
      rowOf(sheet, 'Roles').getCell(8).value = 'una nota'
    })
    const res = await upload(c, file)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ created: 1, warnings: [expect.stringMatching(/Comentarios/)] })
    expect(await saved()).toEqual([['Roles', 'Parcial', 'texto']])
  })

  it('se puede importar en una plantilla PUBLICADA (los textos se editan en cualquier estado)', async () => {
    const c = await setup()
    await db.template.update({ where: { id: c.template.id }, data: { status: 'PUBLISHED' } })
    const file = await editedMatrix(c, (sheet) => (rowOf(sheet, 'Roles').getCell(COL.Cumple).value = 'ok'))
    expect((await upload(c, file)).status).toBe(201)
    expect(await db.suggestedFinding.count()).toBe(1)
  })

  it('con errores: 422 con la fila de cada uno y NO se guarda NINGUNA celda (todo o nada)', async () => {
    const c = await setup()
    const file = await editedMatrix(c, (sheet) => {
      rowOf(sheet, 'Políticas').getCell(COL['No cumple']).value = 'esta sí es válida'
      rowOf(sheet, 'Roles').getCell(1).value = c.control('Organizacionales').id // un agrupador
      rowOf(sheet, 'Roles').getCell(COL.Parcial).value = 'texto'
      rowOf(sheet, 'Antecedentes').getCell(1).value = UNKNOWN_ID // de ninguna plantilla
      rowOf(sheet, 'Antecedentes').getCell(COL.Parcial).value = 'texto'
    })
    const res = await upload(c, file)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_IMPORT_INVALID')
    expect(res.body.error.details.errors.map((e: { row: number }) => e.row)).toEqual([3, 4])
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it('una fila con el mismo control repetido: error; un ID de otra plantilla: error', async () => {
    const c = await setup()
    const other = await db.template.create({ data: { name: 'Otra' } })
    await seedControls(db, other.id, [{ title: 'ajeno' }])
    const foreign = await db.control.findFirstOrThrow({ where: { templateId: other.id } })
    const file = await editedMatrix(c, (sheet) => {
      rowOf(sheet, 'Roles').getCell(1).value = c.control('Políticas').id
      rowOf(sheet, 'Roles').getCell(COL.Parcial).value = 'x'
      rowOf(sheet, 'Políticas').getCell(COL.Parcial).value = 'y'
      rowOf(sheet, 'Antecedentes').getCell(1).value = foreign.id
      rowOf(sheet, 'Antecedentes').getCell(COL.Parcial).value = 'z'
    })
    const res = await upload(c, file)
    expect(res.body.error.details.errors.map((e: { message: string }) => e.message)).toEqual([
      expect.stringMatching(/ya aparece en la fila 2/),
      expect.stringMatching(/no corresponde/),
    ])
    expect(await db.suggestedFinding.count()).toBe(0)
  })

  it.each([
    ['sin archivo', async () => undefined, /Falta el archivo/],
    ['un archivo que no es Excel', async () => Buffer.from('a,b'), /no es un Excel/],
    [
      'sin la columna ID',
      async () => {
        const w = new ExcelJS.Workbook()
        w.addWorksheet('Hallazgos').addRow(['Control', '0 – No cumple'])
        return Buffer.from(await w.xlsx.writeBuffer())
      },
      /columna "ID"/,
    ],
    [
      'sin ninguna columna de opción de esta escala',
      async () => {
        const w = new ExcelJS.Workbook()
        w.addWorksheet('Hallazgos').addRow(['ID', 'Control', '7 – Otra escala'])
        return Buffer.from(await w.xlsx.writeBuffer())
      },
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
          .attach('file', file, 'x.xlsx')
      ).status,
    ).toBe(401)
    expect((await upload(c, file, { scaleId: UNKNOWN_ID })).body.error.code).toBe('SCALE_NOT_FOUND')
    const missing = await api()
      .post(`${T}/${UNKNOWN_ID}/suggested-findings/import`)
      .query({ scaleId: c.scale.id })
      .set('authorization', await as('manager'))
      .attach('file', file, 'x.xlsx')
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
      include: { levels: true },
    })
    const c: Ctx = {
      ...c0,
      scale,
      level: (label: string) => scale.levels.find((l) => l.label === label)!,
    } as unknown as Ctx

    const first = await editedMatrix(c, (sheet) => {
      sheet.eachRow((row, n) => {
        if (n === 1) return
        for (let level = 0; level < 5; level++) row.getCell(5 + level).value = `texto ${n}-${level}`
      })
    })
    const created = await upload(c, first)
    expect(created.body.data).toMatchObject({ created: 1500, updated: 0, unchanged: 0 })
    expect(await db.suggestedFinding.count()).toBe(1500)

    const second = await editedMatrix(c, (sheet) => {
      sheet.eachRow((row, n) => {
        if (n === 1) return
        for (let level = 0; level < 5; level++) row.getCell(5 + level).value = `cambiado ${n}-${level}`
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
      const file = await editedMatrix(c, (sheet) => {
        rowOf(sheet, 'Políticas').getCell(COL.Parcial).value = 'nueva (se crea antes de fallar)'
        rowOf(sheet, 'Roles').getCell(COL.Cumple).value = 'BOOM'
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
