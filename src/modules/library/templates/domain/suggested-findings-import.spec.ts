import { describe, expect, it } from 'vitest'
import {
  levelHeader,
  matchLevelColumns,
  planSuggestedImport,
  type HeaderCell,
  type LevelRef,
  type MatrixRow,
  type SuggestedImportPlan,
} from './suggested-findings-import.js'

const LEVELS: LevelRef[] = [
  { id: 'lv-0', value: 0, label: 'No cumple' },
  { id: 'lv-50', value: 50, label: 'Parcial' },
  { id: 'lv-100', value: 100, label: 'Cumple' },
]
const headers = (...texts: string[]): HeaderCell[] => texts.map((header, i) => ({ column: i + 1, header }))

describe('matchLevelColumns', () => {
  it('reconoce las opciones por el puntaje ("50 – Parcial") aunque la etiqueta cambie o el separador sea otro', () => {
    const match = matchLevelColumns(
      headers('ID', 'Dominio', 'Referencia', 'Control', '0 – No cumple', '50 - Cumple en parte', '100: Cumple'),
      LEVELS,
    )
    expect([...match.levelByColumn]).toEqual([
      [5, 'lv-0'],
      [6, 'lv-50'],
      [7, 'lv-100'],
    ])
    expect(match.ignored).toEqual([])
    expect(match.issues).toEqual([])
  })

  it('reconoce por etiqueta cuando la cabecera no lleva puntaje (sin distinguir mayúsculas ni espacios)', () => {
    const match = matchLevelColumns(headers('Control', '  no   CUMPLE ', 'Parcial'), LEVELS)
    expect([...match.levelByColumn]).toEqual([
      [2, 'lv-0'],
      [3, 'lv-50'],
    ])
  })

  it('el puntaje con coma decimal y los decimales de la escala se reconocen', () => {
    const decimals: LevelRef[] = [
      { id: 'a', value: 2.5, label: 'Definido' },
      { id: 'b', value: 3, label: 'Gestionado' },
    ]
    expect([...matchLevelColumns(headers('2,5 – Definido', '2.5 - otro nombre'), decimals).levelByColumn]).toEqual([
      [1, 'a'],
    ])
  })

  it('las columnas que no son ni del sistema ni de una opción se informan como ignoradas (para que un error de escritura no pase inadvertido)', () => {
    const match = matchLevelColumns(headers('ID', 'Control', '0 – No cumple', 'Notas', '75 – Casi'), LEVELS)
    expect(match.ignored).toEqual(['Notas', '75 – Casi'])
    expect([...match.levelByColumn]).toEqual([[3, 'lv-0']])
  })

  it('dos columnas de la misma opción: error', () => {
    const match = matchLevelColumns(headers('0 – No cumple', 'No cumple'), LEVELS)
    expect(match.issues).toEqual([{ row: 1, message: expect.stringMatching(/columnas 1 y 2.*misma opción/) }])
  })

  it('ninguna columna de opción: error explicativo', () => {
    const match = matchLevelColumns(headers('ID', 'Control', 'Notas'), LEVELS)
    expect(match.issues).toEqual([{ row: 1, message: expect.stringMatching(/ninguna columna de opción/) }])
  })

  it('la cabecera que escribe la exportación es reconocida por la importación (ida y vuelta)', () => {
    const match = matchLevelColumns(headers(...LEVELS.map(levelHeader)), LEVELS)
    expect([...match.levelByColumn].map(([, id]) => id)).toEqual(['lv-0', 'lv-50', 'lv-100'])
  })
})

const A = '0199c0de-0000-7000-8000-00000000000a'
const B = '0199c0de-0000-7000-8000-00000000000b'
const GROUP = '0199c0de-0000-7000-8000-00000000000c'
const LEAVES = new Set([A, B])
const COLUMNS = new Map([
  [5, 'lv-0'],
  [6, 'lv-50'],
])
const row = (n: number, controlId: string | undefined, ...cells: Array<[number, string]>): MatrixRow => ({
  row: n,
  controlId,
  cells: cells.map(([column, text]) => ({ column, text })),
})
const okOf = (plan: SuggestedImportPlan) => {
  if (!plan.ok) throw new Error(`se esperaba un plan: ${JSON.stringify(plan.issues)}`)
  return plan.cells
}
const issuesOf = (plan: SuggestedImportPlan) => {
  if (plan.ok) throw new Error('se esperaban errores')
  return plan.issues
}

describe('planSuggestedImport', () => {
  it('una sugerencia por celda con texto, en la opción de su columna', () => {
    const cells = okOf(
      planSuggestedImport(
        [row(2, A, [5, 'Falta política'], [6, 'Incompleta']), row(3, B, [6, 'Parcial en B'])],
        COLUMNS,
        LEAVES,
      ),
    )
    expect(cells).toEqual([
      { controlId: A, levelId: 'lv-0', text: 'Falta política' },
      { controlId: A, levelId: 'lv-50', text: 'Incompleta' },
      { controlId: B, levelId: 'lv-50', text: 'Parcial en B' },
    ])
  })

  it('las celdas de columnas que no son de una opción (Control, Notas…) se ignoran', () => {
    const cells = okOf(
      planSuggestedImport([row(2, A, [4, 'título del control'], [5, 'texto'], [9, 'notas'])], COLUMNS, LEAVES),
    )
    expect(cells).toEqual([{ controlId: A, levelId: 'lv-0', text: 'texto' }])
  })

  it('una fila sin ningún texto de opción se salta, aunque no tenga ID (nada que guardar, nada que exigir)', () => {
    expect(
      okOf(planSuggestedImport([row(2, undefined), row(3, A), row(4, undefined, [4, 'solo título'])], COLUMNS, LEAVES)),
    ).toEqual([])
  })

  it('el ID se compara sin distinguir mayúsculas', () => {
    expect(okOf(planSuggestedImport([row(2, A.toUpperCase(), [5, 'x'])], COLUMNS, LEAVES))).toHaveLength(1)
  })

  it.each([
    ['sin ID pero con texto', undefined, /Falta el ID/],
    ['ID que no es un uuid', 'A.5.1', /no corresponde/],
    ['ID de un agrupador (no es hoja)', GROUP, /no corresponde a un control evaluable/],
    ['ID de otra plantilla', '0199c0de-0000-7000-8000-0000000000ff', /no corresponde/],
  ])('%s: error con su fila', (_caso, id, message) => {
    expect(issuesOf(planSuggestedImport([row(7, id, [5, 'texto'])], COLUMNS, LEAVES))).toEqual([
      { row: 7, message: expect.stringMatching(message) },
    ])
  })

  it('el mismo control dos veces: error en la segunda fila', () => {
    expect(issuesOf(planSuggestedImport([row(2, A, [5, 'a']), row(3, A, [6, 'b'])], COLUMNS, LEAVES))).toEqual([
      { row: 3, message: 'El control ya aparece en la fila 2' },
    ])
  })

  it('un texto demasiado largo es error; se informan todos los errores, ordenados por fila', () => {
    const issues = issuesOf(
      planSuggestedImport(
        [row(2, GROUP, [5, 'x']), row(3, B, [5, 'y'.repeat(20001)]), row(4, undefined, [6, 'z'])],
        COLUMNS,
        LEAVES,
      ),
    )
    expect(issues.map((i) => i.row)).toEqual([2, 3, 4])
  })

  it('más de 5000 filas: un solo error', () => {
    const many = Array.from({ length: 5001 }, (_v, i) => row(i + 2, A))
    expect(issuesOf(planSuggestedImport(many, COLUMNS, LEAVES))).toEqual([
      { row: 0, message: expect.stringMatching(/máximo de 5000/) },
    ])
  })
})
