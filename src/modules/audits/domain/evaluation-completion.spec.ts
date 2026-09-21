import { describe, expect, it } from 'vitest'
import { missingForCompletion, requiresEvidence, requiresFindings } from './evaluation-completion.js'

const level = (value: number) => ({ value })
const MIN = level(0)
const MID = level(50)
const MAX = level(100)

describe('requiresFindings', () => {
  it('por debajo del esperado: sí; igual o por encima: no', () => {
    expect(requiresFindings(MID, MIN)).toBe(true)
    expect(requiresFindings(MID, MID)).toBe(false)
    expect(requiresFindings(MID, MAX)).toBe(false)
  })
})

describe('requiresEvidence', () => {
  it('por encima del mínimo: sí; en el mínimo: no', () => {
    expect(requiresEvidence(MID, MIN)).toBe(true)
    expect(requiresEvidence(MAX, MIN)).toBe(true)
    expect(requiresEvidence(MIN, MIN)).toBe(false)
  })

  it('borde: una escala sin cero (mínimo = 1) también exige evidencia solo por ENCIMA de su mínimo', () => {
    const ONE = level(1)
    expect(requiresEvidence(ONE, ONE)).toBe(false)
    expect(requiresEvidence(level(2), ONE)).toBe(true)
  })
})

describe('missingForCompletion', () => {
  const input = (over: Partial<Parameters<typeof missingForCompletion>[0]> = {}) => ({
    achievedLevelId: 'lv-max',
    isNotApplicable: false,
    notApplicableReason: null,
    findings: null,
    ...over,
  })
  const levels = (achieved: typeof MIN | null, expected = MID) => ({ expected, achieved, minimum: MIN })

  it('cumple en el mínimo, sin hallazgo ni evidencia: nada falta', () => {
    expect(missingForCompletion(input({ achievedLevelId: 'lv-0' }), levels(MIN, MIN), 0)).toEqual([])
  })

  it('sin nivel alcanzado y sin N/A: falta ACHIEVED_LEVEL_OR_NOT_APPLICABLE (y nada más, aunque falten otras cosas)', () => {
    expect(missingForCompletion(input({ achievedLevelId: null }), levels(null), 0)).toEqual([
      'ACHIEVED_LEVEL_OR_NOT_APPLICABLE',
    ])
  })

  it('por debajo del esperado sin hallazgo: falta FINDINGS', () => {
    expect(missingForCompletion(input(), levels(MIN), 0)).toEqual(['FINDINGS'])
  })

  it('por debajo del esperado CON hallazgo: no falta nada (estar por debajo no exige evidencia si además es el mínimo)', () => {
    expect(missingForCompletion(input({ findings: 'no existe' }), levels(MIN), 0)).toEqual([])
  })

  it('por encima del mínimo sin evidencia: falta EVIDENCE', () => {
    expect(missingForCompletion(input(), levels(MID, MID), 0)).toEqual(['EVIDENCE'])
  })

  it('por encima del mínimo, por debajo del esperado, sin hallazgo ni evidencia: faltan los dos, en orden', () => {
    expect(missingForCompletion(input(), levels(MID, MAX), 0)).toEqual(['FINDINGS', 'EVIDENCE'])
  })

  it('por encima del mínimo con evidencia: no falta nada', () => {
    expect(missingForCompletion(input(), levels(MID, MID), 1)).toEqual([])
  })

  it('N/A con motivo: nada falta, aunque no haya nivel ni evidencia', () => {
    expect(
      missingForCompletion(input({ isNotApplicable: true, notApplicableReason: 'no aplica' }), levels(null), 0),
    ).toEqual([])
  })

  it('N/A sin motivo: falta NOT_APPLICABLE_REASON, y nada más', () => {
    expect(missingForCompletion(input({ isNotApplicable: true }), levels(null), 0)).toEqual(['NOT_APPLICABLE_REASON'])
  })

  it('N/A gana sobre cualquier otra falta: no exige nivel, hallazgo ni evidencia', () => {
    expect(
      missingForCompletion(
        { achievedLevelId: null, isNotApplicable: true, notApplicableReason: 'x', findings: null },
        levels(null, MAX),
        0,
      ),
    ).toEqual([])
  })
})
