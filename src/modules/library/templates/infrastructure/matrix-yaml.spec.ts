import { describe, expect, it } from 'vitest'
import '../../../../app-errors.js'
import { matchLevelColumns, planSuggestedImport } from '../domain/suggested-findings-import.js'
import { readMatrixYaml, writeMatrixYaml } from './matrix-yaml.js'

const LEVELS = [
  { id: 'lv-0', value: 0, label: 'No cumple' },
  { id: 'lv-100', value: 100, label: 'Cumple' },
]
const ID_A = '0199c0de-0000-7000-8000-00000000000a'
const ID_B = '0199c0de-0000-7000-8000-00000000000b'

const rejection = (work: () => unknown) => {
  try {
    work()
    return undefined
  } catch (error) {
    return error
  }
}

describe('matriz de hallazgos en YAML', () => {
  it('ida y vuelta: lo que se escribe se lee igual, se reconoce por la importación y sobreviven saltos de línea, acentos y claves con caracteres especiales', async () => {
    const file = writeMatrixYaml({
      levels: LEVELS,
      controls: [
        {
          id: ID_A,
          domain: 'Organizacionales',
          reference: 'A.5.1',
          title: 'Políticas',
          texts: new Map([
            ['lv-0', 'Línea 1\nLínea 2 — ñ €'],
            ['lv-100', 'texto: con dos puntos'],
          ]),
        },
        { id: ID_B, domain: 'Personas', reference: null, title: 'Roles', texts: new Map() },
      ],
    })
    const content = readMatrixYaml(file)
    const match = matchLevelColumns(content.headers, LEVELS)
    expect(match.issues).toEqual([])
    expect(match.ignored).toEqual([])
    const plan = planSuggestedImport(content.rows, match.levelByColumn, new Set([ID_A, ID_B]))
    expect(plan).toEqual({
      ok: true,
      cells: [
        { controlId: ID_A, levelId: 'lv-0', text: 'Línea 1\nLínea 2 — ñ €' },
        { controlId: ID_A, levelId: 'lv-100', text: 'texto: con dos puntos' },
      ],
    })
  })

  it('las cabeceras van con el puntaje ("0 – No cumple") y aparecen SIEMPRE, aunque no haya texto (como las columnas de Excel)', () => {
    const file = writeMatrixYaml({
      levels: LEVELS,
      controls: [{ id: ID_A, domain: 'D', reference: null, title: 'x', texts: new Map([['lv-0', 'texto']]) }],
    })
    expect(file.toString('utf8')).toContain('0 – No cumple: texto')
    expect(file.toString('utf8')).toContain('100 – Cumple: ""')
  })

  it('lee un archivo armado a mano: conserva la posición de cada entrada y sus claves', () => {
    const file = Buffer.from(
      `findings:
  - id: ${ID_A}
    control: x
    texts:
      No cumple: texto A
      Notas: nota
  - id: ${ID_B}
    control: y
  - control: sin id
    texts:
      No cumple: texto huérfano
`,
      'utf8',
    )
    const content = readMatrixYaml(file)
    expect(content.rows.map((r) => [r.row, r.controlId, r.cells.map((c) => c.text)])).toEqual([
      [1, ID_A, ['texto A', 'nota']],
      [2, ID_B, []],
      [3, undefined, ['texto huérfano']],
    ])
  })

  it.each([
    ['un archivo que no es YAML', () => Buffer.from('findings: [x: y: z\n', 'utf8'), /no es un YAML válido/],
    ['una lista en vez de un objeto', () => Buffer.from('- a\n- b\n', 'utf8'), /formato esperado/],
  ])('%s: TEMPLATE_IMPORT_INVALID', (_caso, make, message) => {
    const error = rejection(() => readMatrixYaml(make()))
    expect(error).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
      details: { errors: [{ row: 0, message: expect.stringMatching(message) }] },
    })
  })

  it('sin "findings": una matriz vacía (0 filas, 0 cabeceras), no un error', () => {
    expect(readMatrixYaml(Buffer.from('name: x\n', 'utf8'))).toEqual({ headers: [], rows: [] })
  })
})
