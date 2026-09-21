import { describe, expect, it } from 'vitest'
import { buildImportPlan, type ImportPlan, type RawRow } from './control-import.js'

/** Filas de una hoja con la cabecera en la 1: los datos empiezan en la fila 2. */
const rows = (...items: Array<Omit<RawRow, 'row'>>): RawRow[] => items.map((item, i) => ({ row: i + 2, ...item }))
const lv = (level: number | string, title: string, extra: Omit<RawRow, 'row' | 'level' | 'title'> = {}) => ({
  level: String(level),
  title,
  ...extra,
})
const nodesOf = (plan: ImportPlan) => {
  if (!plan.ok) throw new Error(`se esperaba un plan: ${JSON.stringify(plan.issues)}`)
  return plan.nodes
}
const issuesOf = (plan: ImportPlan) => {
  if (plan.ok) throw new Error('se esperaban errores')
  return plan.issues
}

describe('por nivel (formato actual)', () => {
  it('ISO 27001: dominios y controles; el padre es la fila anterior de nivel menor', () => {
    const nodes = nodesOf(
      buildImportPlan(
        rows(
          lv(1, 'Organizacionales', { reference: 'A.5' }),
          lv(2, 'Políticas', { reference: 'A.5.1' }),
          lv(2, 'Roles', { reference: 'A.5.2' }),
          lv(1, 'Personas', { reference: 'A.6' }),
          lv(2, 'Selección', { reference: 'A.6.1' }),
        ),
        'level',
      ),
    )
    expect(nodes.map((n) => [n.title, n.parentIndex, n.position])).toEqual([
      ['Organizacionales', null, 0],
      ['Políticas', 0, 0],
      ['Roles', 0, 1],
      ['Personas', null, 1],
      ['Selección', 3, 0],
    ])
    expect(nodes[1]).toMatchObject({ reference: 'A.5.1', description: null })
  })

  it('COBIT: 4 niveles, y de vuelta a un nivel superior', () => {
    const nodes = nodesOf(
      buildImportPlan(
        rows(
          lv(1, 'APO'),
          lv(2, 'APO01'),
          lv(3, 'APO01.01'),
          lv(4, 'a'),
          lv(4, 'b'),
          lv(3, 'APO01.02'),
          lv(2, 'APO02'),
          lv(1, 'EDM'),
        ),
        'level',
      ),
    )
    expect(nodes.map((n) => n.parentIndex)).toEqual([null, 0, 1, 2, 2, 1, 0, null])
    expect(nodes.map((n) => n.position)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('ramas de distinta profundidad bajo el mismo dominio', () => {
    const nodes = nodesOf(
      buildImportPlan(rows(lv(1, 'D'), lv(2, 'directa'), lv(2, 'grupo'), lv(3, 'sub'), lv(4, 'profunda')), 'level'),
    )
    expect(nodes.map((n) => n.parentIndex)).toEqual([null, 0, 0, 2, 3])
  })

  it('la referencia no interviene: se repite, falta o es cualquier cosa sin afectar a la jerarquía', () => {
    const nodes = nodesOf(
      buildImportPlan(rows(lv(1, 'D', { reference: 'II' }), lv(2, 'a', { reference: 'II' }), lv(2, 'b')), 'level'),
    )
    expect(nodes.map((n) => [n.reference, n.parentIndex])).toEqual([
      ['II', null],
      ['II', 0],
      [null, 0],
    ])
  })

  it('acepta el nivel como "2", "2.0" (Excel numérico) y conserva la descripción', () => {
    const nodes = nodesOf(buildImportPlan(rows(lv('1', 'D'), lv('2.0', 'h', { description: 'texto' })), 'level'))
    expect(nodes[1]).toMatchObject({ parentIndex: 0, description: 'texto' })
  })

  it('un solo dominio con un solo hijo es un plan válido (que sea publicable lo decide otra regla)', () => {
    expect(nodesOf(buildImportPlan(rows(lv(1, 'D'), lv(2, 'h')), 'level'))).toHaveLength(2)
  })

  it.each([
    ['la primera fila no es nivel 1', [lv(2, 'x')], /salta de 0 a 2/, 2],
    ['un nivel salta dos', [lv(1, 'a'), lv(3, 'b')], /salta de 1 a 3/, 3],
    ['nivel 0', [lv(0, 'a')], /Nivel inválido/, 2],
    ['nivel negativo', [lv(-1, 'a')], /Nivel inválido/, 2],
    ['nivel decimal', [lv('1.5', 'a')], /Nivel inválido/, 2],
    ['nivel texto', [lv('uno', 'a')], /Nivel inválido/, 2],
    ['nivel vacío', [{ title: 'a' }], /Nivel inválido/, 2],
  ])('rechaza: %s', (_caso, input, message, row) => {
    const issues = issuesOf(buildImportPlan(rows(...input), 'level'))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ row, message: expect.stringMatching(message) })
  })

  it('el título es obligatorio y se informan TODOS los errores del archivo, con su número de fila y en orden', () => {
    const issues = issuesOf(
      buildImportPlan(
        rows(lv(1, 'ok'), lv(1, ''), lv(3, 'salto'), { level: 'x', title: 'raro' }, { level: '2' }),
        'level',
      ),
    )
    expect(issues.map((i) => i.row)).toEqual([3, 4, 5, 6])
    expect(issues[0]!.message).toBe('Falta el título')
    expect(issues.map((i) => i.row)).toEqual([...issues.map((i) => i.row)].sort((a, b) => a - b))
  })

  it('respeta la profundidad máxima', () => {
    const chain = Array.from({ length: 11 }, (_v, i) => lv(i + 1, `n${i + 1}`))
    const issues = issuesOf(buildImportPlan(rows(...chain), 'level'))
    expect(issues).toEqual([{ row: 12, message: expect.stringMatching(/profundidad máxima/) }])
    expect(buildImportPlan(rows(...chain.slice(0, 10)), 'level').ok).toBe(true)
  })

  it('un archivo vacío o gigante se rechaza con un solo error', () => {
    expect(issuesOf(buildImportPlan([], 'level'))).toEqual([{ row: 0, message: expect.stringMatching(/ninguna fila/) }])
    const many = Array.from({ length: 5001 }, (_v, i) => ({ row: i + 2, level: '1', title: 't' }))
    expect(issuesOf(buildImportPlan(many, 'level'))[0]!.message).toMatch(/máximo de 5000/)
  })
})

describe('por código padre (archivos del proyecto anterior)', () => {
  const pr = (reference: string, title: string, parentReference = '') => ({ reference, title, parentReference })

  it('resuelve el padre por referencia dentro del archivo, aunque el hijo esté antes que el padre', () => {
    const nodes = nodesOf(
      buildImportPlan(rows(pr('A.5.1', 'hijo', 'A.5'), pr('A.5', 'padre', '-'), pr('A.6', 'otro')), 'parent-reference'),
    )
    // orden de lectura: los dominios en el orden del archivo (A.5 antes que A.6), cada uno con sus hijos detrás
    expect(nodes.map((n) => [n.title, n.parentIndex, n.position])).toEqual([
      ['padre', null, 0],
      ['hijo', 0, 0],
      ['otro', null, 1],
    ])
  })

  it('"-" y vacío significan sin padre', () => {
    const nodes = nodesOf(buildImportPlan(rows(pr('a', 'A', '-'), pr('b', 'B', '')), 'parent-reference'))
    expect(nodes.map((n) => n.parentIndex)).toEqual([null, null])
  })

  it('padre inexistente, referencia repetida y ciclo se informan con la fila', () => {
    expect(issuesOf(buildImportPlan(rows(pr('a', 'A', 'fantasma')), 'parent-reference'))).toEqual([
      { row: 2, message: 'El padre "fantasma" no existe en el archivo' },
    ])
    expect(issuesOf(buildImportPlan(rows(pr('a', 'A'), pr('a', 'B')), 'parent-reference'))[0]).toMatchObject({
      row: 3,
      message: expect.stringMatching(/ya se usó en la fila 2/),
    })
    const cycle = issuesOf(
      buildImportPlan(rows(pr('raiz', 'R'), pr('a', 'A', 'b'), pr('b', 'B', 'a')), 'parent-reference'),
    )
    expect(cycle.map((i) => i.row)).toEqual([3, 4])
    expect(cycle[0]!.message).toMatch(/ciclo/)
  })

  it('respeta el orden de los hermanos en el archivo', () => {
    const nodes = nodesOf(buildImportPlan(rows(pr('d', 'D'), pr('z', 'z', 'd'), pr('a', 'a', 'd')), 'parent-reference'))
    expect(nodes.map((n) => [n.title, n.position])).toEqual([
      ['D', 0],
      ['z', 0],
      ['a', 1],
    ])
  })
})
