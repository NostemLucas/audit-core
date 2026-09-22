import { describe, expect, it } from 'vitest'
import { buildImportPlan, type ImportControlNode, type ImportPlan } from './control-import.js'

const node = (title: string, extra: Omit<ImportControlNode, 'title'> = {}): ImportControlNode => ({ title, ...extra })
const nodesOf = (plan: ImportPlan) => {
  if (!plan.ok) throw new Error(`se esperaba un plan: ${JSON.stringify(plan.issues)}`)
  return plan.nodes
}
const issuesOf = (plan: ImportPlan) => {
  if (plan.ok) throw new Error('se esperaban errores')
  return plan.issues
}

describe('buildImportPlan', () => {
  it('ISO 27001: dominios y controles; la anidación del YAML ES la jerarquía', () => {
    const nodes = nodesOf(
      buildImportPlan([
        node('Organizacionales', {
          reference: 'A.5',
          controls: [node('Políticas', { reference: 'A.5.1' }), node('Roles', { reference: 'A.5.2' })],
        }),
        node('Personas', { reference: 'A.6', controls: [node('Selección', { reference: 'A.6.1' })] }),
      ]),
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

  it('COBIT: 4 niveles, y ramas hermanas a distinta profundidad', () => {
    const nodes = nodesOf(
      buildImportPlan([
        node('APO', {
          controls: [
            node('APO01', { controls: [node('APO01.01', { controls: [node('a'), node('b')] }), node('APO01.02')] }),
            node('APO02'),
          ],
        }),
        node('EDM'),
      ]),
    )
    expect(nodes.map((n) => n.title)).toEqual(['APO', 'APO01', 'APO01.01', 'a', 'b', 'APO01.02', 'APO02', 'EDM'])
    expect(nodes.map((n) => n.parentIndex)).toEqual([null, 0, 1, 2, 2, 1, 0, null])
    expect(nodes.map((n) => n.position)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('la referencia no interviene: se repite, falta o es cualquier cosa sin afectar a la jerarquía', () => {
    const nodes = nodesOf(
      buildImportPlan([node('D', { reference: 'II', controls: [node('a', { reference: 'II' }), node('b')] })]),
    )
    expect(nodes.map((n) => [n.reference, n.parentIndex])).toEqual([
      ['II', null],
      ['II', 0],
      [null, 0],
    ])
  })

  it('un solo dominio con un solo hijo es un plan válido (que sea publicable lo decide otra regla)', () => {
    expect(nodesOf(buildImportPlan([node('D', { controls: [node('h')] })]))).toHaveLength(2)
  })

  it('el título es obligatorio y se informan TODOS los errores del archivo, en orden de lectura', () => {
    const issues = issuesOf(
      buildImportPlan([
        node('ok'), // 1: ok
        node('', { controls: [node('nieto')] }), // 2: falta título (el nieto, 3, está bien)
        node(''), // 4: falta título
      ]),
    )
    expect(issues.map((i) => i.row)).toEqual([2, 4])
    expect(issues.every((i) => i.message === 'Falta el título')).toBe(true)
  })

  it('respeta la profundidad máxima', () => {
    let deepest: ImportControlNode = node('n11')
    for (let i = 10; i >= 1; i--) deepest = node(`n${i}`, { controls: [deepest] })
    const issues = issuesOf(buildImportPlan([deepest]))
    expect(issues).toEqual([{ row: 11, message: expect.stringMatching(/profundidad máxima/) }])

    let ok: ImportControlNode = node('n10')
    for (let i = 9; i >= 1; i--) ok = node(`n${i}`, { controls: [ok] })
    expect(buildImportPlan([ok]).ok).toBe(true)
  })

  it('un archivo vacío o gigante se rechaza con un solo error', () => {
    expect(issuesOf(buildImportPlan([]))).toEqual([{ row: 0, message: expect.stringMatching(/ningún control/) }])
    const many = Array.from({ length: 5001 }, (_v, i) => node(`t${i}`))
    expect(issuesOf(buildImportPlan(many))[0]!.message).toMatch(/máximo de 5000/)
  })
})
