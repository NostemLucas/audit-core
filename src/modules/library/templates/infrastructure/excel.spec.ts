import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import '../../../../app-errors.js'
import { buildImportPlan } from '../domain/control-import.js'
import { readTemplateWorkbook, valueToText } from './excel-reader.js'
import { writeTemplateWorkbook } from './excel-writer.js'

type Cell = ExcelJS.CellValue
async function book(build: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
const sheetWith = (workbook: ExcelJS.Workbook, name: string, rows: Cell[][]) => {
  const sheet = workbook.addWorksheet(name)
  rows.forEach((row) => sheet.addRow(row))
  return sheet
}
const rejection = (work: Promise<unknown>) =>
  work.then(
    () => undefined,
    (error: unknown) => error,
  )

describe('lector', () => {
  it('formato actual: reconoce las columnas por nombre (sin importar mayúsculas ni tildes de la cabecera)', async () => {
    const file = await book((w) =>
      sheetWith(w, 'Controles', [
        ['NIVEL', 'REFERENCIA', 'Titulo', 'DESCRIPCION'],
        [1, 'A.5', 'Organizacionales', 'texto'],
        [2, 'A.5.1', 'Políticas', undefined],
      ]),
    )
    const content = await readTemplateWorkbook(file)
    expect(content.mode).toBe('level')
    expect(content.warnings).toEqual([])
    expect(content.rows).toEqual([
      {
        row: 2,
        level: '1',
        reference: 'A.5',
        title: 'Organizacionales',
        description: 'texto',
        parentReference: undefined,
      },
      {
        row: 3,
        level: '2',
        reference: 'A.5.1',
        title: 'Políticas',
        description: undefined,
        parentReference: undefined,
      },
    ])
  })

  it('formato anterior: hoja "Standards", "Código padre" y guía del auditor (se ignora con aviso); columnas de sistema ocultas se ignoran', async () => {
    const file = await book((w) =>
      sheetWith(w, 'Standards', [
        ['ID (Sistema)', 'Código', 'Título', 'Descripción', 'Código Padre', 'ID Padre', 'Guía Auditor'],
        ['uuid-1', 'A.5', 'Dominio', '', '-', '', 'guía'],
        ['uuid-2', 'A.5.1', 'Hijo', 'desc', 'A.5', 'uuid-1', ''],
      ]),
    )
    const content = await readTemplateWorkbook(file)
    expect(content.mode).toBe('parent-reference')
    expect(content.rows.map((r) => [r.reference, r.title, r.parentReference])).toEqual([
      ['A.5', 'Dominio', '-'],
      ['A.5.1', 'Hijo', 'A.5'],
    ])
    expect(content.warnings).toHaveLength(2)
    expect(content.warnings.join(' ')).toMatch(/guía del auditor.*ignoró/)
    expect(content.warnings.join(' ')).toMatch(/Código padre/)
  })

  it('el nombre sale de la hoja "Plantilla" (Campo / Valor) si la trae', async () => {
    const file = await book((w) => {
      sheetWith(w, 'Plantilla', [
        ['Campo', 'Valor'],
        ['Versión', '2022'],
        ['Nombre', ' ISO/IEC 27001:2022 '],
      ])
      sheetWith(w, 'Controles', [
        ['Nivel', 'Título'],
        [1, 'x'],
      ])
    })
    expect((await readTemplateWorkbook(file)).name).toBe('ISO/IEC 27001:2022')
  })

  it('sin hoja "Controles" usa la primera; las filas en blanco se saltan y la numeración de filas se conserva', async () => {
    const file = await book((w) =>
      sheetWith(w, 'Hoja1', [['Nivel', 'Título'], [1, 'a'], [], [2, 'b'], [undefined, undefined]]),
    )
    const content = await readTemplateWorkbook(file)
    expect(content.rows.map((r) => [r.row, r.title])).toEqual([
      [2, 'a'],
      [4, 'b'],
    ])
  })

  it('celdas de fórmula, texto enriquecido, hipervínculo, número y fecha se leen como texto', async () => {
    const file = await book((w) => {
      const sheet = sheetWith(w, 'Controles', [['Nivel', 'Referencia', 'Título', 'Descripción']])
      sheet.addRow([
        1,
        { formula: '1+1', result: 2 },
        { richText: [{ text: 'Con ' }, { text: 'formato', font: { bold: true } }] },
        { text: 'enlace', hyperlink: 'https://x.y' },
      ])
      sheet.addRow([2, 3.5, 'plano', new Date('2026-01-02T00:00:00Z')])
    })
    const rows = (await readTemplateWorkbook(file)).rows
    expect(rows[0]).toMatchObject({ reference: '2', title: 'Con formato', description: 'enlace' })
    expect(rows[1]).toMatchObject({ reference: '3.5', title: 'plano', description: '2026-01-02T00:00:00.000Z' })
  })

  it('valueToText: vacío, espacios y error son "sin valor"', () => {
    expect(valueToText(null)).toBeUndefined()
    expect(valueToText(undefined)).toBeUndefined()
    expect(valueToText('   ')).toBeUndefined()
    expect(valueToText({ error: '#N/A' })).toBeUndefined()
    expect(valueToText({ formula: 'A1', result: undefined })).toBeUndefined()
    expect(valueToText(0)).toBe('0')
    expect(valueToText(false)).toBe('false')
  })

  it.each([
    [
      'sin columna Título',
      (w: ExcelJS.Workbook) =>
        sheetWith(w, 'x', [
          ['Nivel', 'Nombre'],
          [1, 'a'],
        ]),
      /columna "Título"/,
    ],
    [
      'sin columna Nivel ni Código padre',
      (w: ExcelJS.Workbook) => sheetWith(w, 'x', [['Título'], ['a']]),
      /columna "Nivel"/,
    ],
  ])('%s: TEMPLATE_IMPORT_INVALID', async (_caso, build, message) => {
    const error = await rejection(readTemplateWorkbook(await book((w) => build(w))))
    expect(error).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
      details: { errors: [{ row: 0, message: expect.stringMatching(message) }] },
    })
  })

  it('un libro sin hojas y un archivo que no es Excel: TEMPLATE_IMPORT_INVALID', async () => {
    expect(await rejection(readTemplateWorkbook(await book(() => undefined)))).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
    })
    const junk = await rejection(readTemplateWorkbook(Buffer.from('esto no es un xlsx, es texto plano')))
    expect(junk).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
      details: { errors: [{ message: expect.stringMatching(/no es un Excel/) }] },
    })
    expect(await rejection(readTemplateWorkbook(Buffer.alloc(0)))).toMatchObject({ code: 'TEMPLATE_IMPORT_INVALID' })
  })
})

describe('ida y vuelta: escribir y volver a leer', () => {
  const controls = [
    {
      level: 1,
      reference: 'A.5',
      title: 'Controles organizacionales',
      description: 'Los controles de la organización',
    },
    { level: 2, reference: 'A.5.1', title: 'Políticas para la seguridad de la información', description: null },
    {
      level: 2,
      reference: null,
      title: '¿Existe un procedimiento de copias de seguridad?',
      description: 'Línea 1\nLínea 2 con acentos: ñ, á, ü y símbolos: €, ≥',
    },
    { level: 3, reference: '=SUMA(A1)', title: '=1+1', description: '   ' },
    { level: 1, reference: 'II', title: 'Segundo dominio', description: 'x'.repeat(5000) },
    { level: 2, reference: 'a)', title: 'Hoja', description: null },
  ]

  it('conserva nivel, referencia, título y descripción (los valores que parecen fórmulas siguen siendo texto)', async () => {
    const file = await writeTemplateWorkbook({ name: 'ISO/IEC 27001:2022', controls })
    const content = await readTemplateWorkbook(file)
    expect(content.name).toBe('ISO/IEC 27001:2022')
    expect(content.mode).toBe('level')
    expect(content.warnings).toEqual([])
    expect(content.rows.map((r) => [Number(r.level), r.reference ?? null, r.title, r.description ?? null])).toEqual(
      controls.map((c) => [c.level, c.reference, c.title, c.description?.trim() || null]),
    )
    const plan = buildImportPlan(content.rows, content.mode)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.nodes.map((n) => n.parentIndex)).toEqual([null, 0, 0, 2, null, 4])
  })

  it('una plantilla vacía se escribe con solo la cabecera y se lee sin filas', async () => {
    const content = await readTemplateWorkbook(await writeTemplateWorkbook({ name: 'Vacía', controls: [] }))
    expect(content.rows).toEqual([])
  })
})
