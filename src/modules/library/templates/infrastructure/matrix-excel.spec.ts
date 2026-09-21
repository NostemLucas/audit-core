import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import '../../../../app-errors.js'
import { matchLevelColumns, planSuggestedImport } from '../domain/suggested-findings-import.js'
import { readMatrixWorkbook, writeMatrixWorkbook } from './matrix-excel.js'

const LEVELS = [
  { id: 'lv-0', value: 0, label: 'No cumple' },
  { id: 'lv-100', value: 100, label: 'Cumple' },
]
const ID_A = '0199c0de-0000-7000-8000-00000000000a'
const ID_B = '0199c0de-0000-7000-8000-00000000000b'

async function book(rows: ExcelJS.CellValue[][], sheetName = 'Hallazgos'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  rows.forEach((row) => sheet.addRow(row))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
const rejection = (work: Promise<unknown>) =>
  work.then(
    () => undefined,
    (error: unknown) => error,
  )

describe('matriz de hallazgos en Excel', () => {
  it('ida y vuelta: lo que se escribe se lee igual, se reconoce por la importación y sobreviven saltos de línea, acentos y fórmulas', async () => {
    const file = await writeMatrixWorkbook({
      levels: LEVELS,
      controls: [
        {
          id: ID_A,
          domain: 'Organizacionales',
          reference: 'A.5.1',
          title: 'Políticas',
          texts: new Map([
            ['lv-0', 'Línea 1\nLínea 2 — ñ €'],
            ['lv-100', '=SUMA(A1)'],
          ]),
        },
        { id: ID_B, domain: 'Personas', reference: null, title: 'Roles', texts: new Map() },
      ],
    })
    const content = await readMatrixWorkbook(file)
    const match = matchLevelColumns(content.headers, LEVELS)
    expect(match.issues).toEqual([])
    expect(match.ignored).toEqual([])
    const plan = planSuggestedImport(content.rows, match.levelByColumn, new Set([ID_A, ID_B]))
    expect(plan).toEqual({
      ok: true,
      cells: [
        { controlId: ID_A, levelId: 'lv-0', text: 'Línea 1\nLínea 2 — ñ €' },
        { controlId: ID_A, levelId: 'lv-100', text: '=SUMA(A1)' },
      ],
    })
  })

  it('la columna ID va oculta y las fijas quedan a la vista', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await writeMatrixWorkbook({ levels: LEVELS, controls: [] })) as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet('Hallazgos')!
    expect(sheet.getColumn(1).hidden).toBe(true)
    expect(sheet.getColumn(2).hidden).toBeFalsy()
    expect(sheet.getRow(1).getCell(5).value).toBe('0 – No cumple')
  })

  it('lee un archivo armado a mano: acepta "ID (Sistema)", salta filas en blanco y conserva los números de fila', async () => {
    const file = await book([
      ['ID (Sistema)', 'Control', 'No cumple', 'Notas'],
      [ID_A, 'x', 'texto A', 'nota'],
      [],
      [ID_B, 'y', undefined, undefined],
      [undefined, 'sin id', 'texto huérfano', undefined],
    ])
    const content = await readMatrixWorkbook(file)
    expect(content.rows.map((r) => [r.row, r.controlId, r.cells.map((c) => c.text)])).toEqual([
      [2, ID_A, ['x', 'texto A', 'nota']],
      [4, ID_B, ['y']],
      [5, undefined, ['sin id', 'texto huérfano']],
    ])
  })

  it.each([
    [
      'un archivo sin columna ID',
      () =>
        book([
          ['Control', 'No cumple'],
          ['x', 'y'],
        ]),
      /columna "ID"/,
    ],
    ['un archivo que no es Excel', async () => Buffer.from('id,control\n1,x'), /no es un Excel/],
    ['un archivo vacío', async () => Buffer.alloc(0), /no es un Excel/],
  ])('%s: TEMPLATE_IMPORT_INVALID', async (_caso, make, message) => {
    const error = await rejection(readMatrixWorkbook(await make()))
    expect(error).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
      details: { errors: [{ row: 0, message: expect.stringMatching(message) }] },
    })
  })

  it('un libro sin hojas: TEMPLATE_IMPORT_INVALID', async () => {
    const workbook = new ExcelJS.Workbook()
    const error = await rejection(readMatrixWorkbook(Buffer.from(await workbook.xlsx.writeBuffer())))
    expect(error).toMatchObject({ code: 'TEMPLATE_IMPORT_INVALID' })
  })
})
