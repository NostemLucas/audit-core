import { describe, expect, it } from 'vitest'
import { computeResults, gapOf, type LevelRef, type ScoredLeaf, tally } from './scoring.js'

const LEVELS: LevelRef[] = [
  { id: 'l0', value: 0, label: 'No cumple' },
  { id: 'l50', value: 50, label: 'Parcial' },
  { id: 'l100', value: 100, label: 'Cumple' },
]
const at = (id: string) => LEVELS.find((l) => l.id === id)!

function leaf(
  domainId: string,
  achieved: string | null,
  expected: string | null = 'l100',
  extra: Partial<ScoredLeaf> = {},
) {
  return {
    domainId,
    status: 'APPROVED',
    isNotApplicable: false,
    expected: expected ? at(expected).value : null,
    achieved: achieved ? at(achieved).value : null,
    achievedLevelId: achieved,
    ...extra,
  } satisfies ScoredLeaf
}

describe('gapOf', () => {
  it('alcanzado − esperado; negativo es no conformidad', () => {
    expect(gapOf(100, 50)).toBe(-50)
    expect(gapOf(50, 100)).toBe(50)
    expect(gapOf(50, 50)).toBe(0)
  })
  it('no arrastra colas de coma flotante', () => {
    expect(gapOf(0.1, 0.4)).toBe(0.3)
  })
})

describe('tally', () => {
  it('cuenta cumplen, por debajo, pendientes y no aplica; lo no aplicable queda fuera de lo demás', () => {
    const t = tally([
      leaf('a', 'l100'), // cumple
      leaf('a', 'l50'), // por debajo
      leaf('a', 'l0'), // por debajo
      leaf('a', null), // pendiente
      leaf('a', null, 'l100', { isNotApplicable: true }), // no aplica
    ])
    expect(t).toEqual({ total: 5, notApplicable: 1, pending: 1, evaluated: 3, meets: 1, below: 2 })
    expect(t.evaluated + t.pending + t.notApplicable).toBe(t.total)
  })

  it('alcanzado IGUAL al esperado cumple; superarlo también', () => {
    expect(tally([leaf('a', 'l50', 'l50'), leaf('a', 'l100', 'l50')])).toMatchObject({ meets: 2, below: 0 })
  })

  it('un criterio sin esperado no cuenta como evaluado (no hay contra qué comparar)', () => {
    expect(tally([leaf('a', 'l50', null)])).toMatchObject({ evaluated: 0, pending: 1, meets: 0, below: 0 })
  })

  it('un "no aplica" con nivel alcanzado residual tampoco cuenta', () => {
    expect(tally([leaf('a', 'l100', 'l100', { isNotApplicable: true })])).toMatchObject({
      evaluated: 0,
      notApplicable: 1,
    })
  })

  it('vacío: todo en cero', () => {
    expect(tally([])).toEqual({ total: 0, notApplicable: 0, pending: 0, evaluated: 0, meets: 0, below: 0 })
  })
})

describe('computeResults', () => {
  const leaves = [
    leaf('d1', 'l100'),
    leaf('d1', 'l50'),
    leaf('d1', 'l0'),
    leaf('d2', 'l100'),
    leaf('d2', null, 'l100', { status: 'IN_PROGRESS' }),
    leaf('d2', null, 'l100', { isNotApplicable: true, status: 'COMPLETED' }),
  ]
  const r = computeResults(leaves, ['d1', 'd2', 'd3'], LEVELS)

  it('el avance cuenta por estado del criterio', () => {
    expect(r.progress).toEqual({ total: 6, notStarted: 0, inProgress: 1, completed: 1, returned: 0, approved: 4 })
  })

  it('el total lleva conteos y distribución, y NO una nota global', () => {
    expect(r.overall).toMatchObject({ total: 6, evaluated: 4, meets: 2, below: 2, pending: 1, notApplicable: 1 })
    expect(r.overall.distribution.map((d) => [d.label, d.count])).toEqual([
      ['No cumple', 1],
      ['Parcial', 1],
      ['Cumple', 2],
    ])
    expect(Object.keys(r.overall)).not.toContain('averageAchieved')
  })

  it('por dominio: conteos, promedios de los MISMOS criterios evaluados y brecha', () => {
    const d1 = r.domains[0]!
    expect(d1).toMatchObject({ domainId: 'd1', evaluated: 3, meets: 1, below: 2 })
    expect(d1.averageExpected).toBe(100)
    expect(d1.averageAchieved).toBe(50) // (100 + 50 + 0) / 3
    expect(d1.gap).toBe(-50)
  })

  it('los pendientes y los no aplicables NO entran en los promedios', () => {
    const d2 = r.domains[1]!
    expect(d2).toMatchObject({ evaluated: 1, pending: 1, notApplicable: 1 })
    expect(d2.averageAchieved).toBe(100)
    expect(d2.averageExpected).toBe(100)
    expect(d2.gap).toBe(0)
  })

  it('un dominio sin criterios evaluados sale con promedios nulos, no con cero', () => {
    const d3 = r.domains[2]!
    expect(d3).toMatchObject({ domainId: 'd3', total: 0, evaluated: 0 })
    expect(d3.averageExpected).toBeNull()
    expect(d3.averageAchieved).toBeNull()
    expect(d3.gap).toBeNull()
  })

  it('conserva el orden de los dominios recibidos y la distribución trae TODAS las opciones', () => {
    expect(r.domains.map((d) => d.domainId)).toEqual(['d1', 'd2', 'd3'])
    expect(r.domains[2]!.distribution.map((d) => d.count)).toEqual([0, 0, 0])
  })

  it('el promedio esperado varía por criterio (madurez): compara niveles con niveles', () => {
    const m = computeResults(
      [leaf('d', 'l50', 'l50'), leaf('d', 'l100', 'l100'), leaf('d', 'l0', 'l50')],
      ['d'],
      LEVELS,
    )
    expect(m.domains[0]).toMatchObject({ averageExpected: 66.67, averageAchieved: 50, gap: -16.67, meets: 2, below: 1 })
  })
})
