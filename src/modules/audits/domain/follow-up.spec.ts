import { describe, expect, it } from 'vitest'
import { carriesOver } from './follow-up.js'

const result = (
  expected: number | null,
  achieved: number | null,
  isNotApplicable = false,
  requiresFollowUp = false,
) => ({
  expected,
  achieved,
  isNotApplicable,
  requiresFollowUp,
})

describe('carriesOver', () => {
  it('cumplió lo esperado (igual o por encima): se traslada', () => {
    expect(carriesOver(result(100, 100))).toBe(true)
    expect(carriesOver(result(50, 100))).toBe(true)
  })
  it('quedó por debajo de lo esperado: se evalúa de nuevo', () => {
    expect(carriesOver(result(100, 50))).toBe(false)
    expect(carriesOver(result(100, 0))).toBe(false)
  })
  it('"no aplica" se traslada, con o sin nivel', () => {
    expect(carriesOver(result(100, null, true))).toBe(true)
    expect(carriesOver(result(null, null, true))).toBe(true)
  })
  it('sin nivel alcanzado o sin esperado no hay nada que trasladar', () => {
    expect(carriesOver(result(100, null))).toBe(false)
    expect(carriesOver(result(null, 100))).toBe(false)
  })
  it('un esperado de 0 se cumple con 0 (no lo confunde con "sin esperado")', () => {
    expect(carriesOver(result(0, 0))).toBe(true)
  })

  it('el líder marcó `requiresFollowUp`: NO se traslada, aunque haya cumplido', () => {
    expect(carriesOver(result(100, 100, false, true))).toBe(false)
  })
  it('`requiresFollowUp` también gana sobre "no aplica": tampoco se traslada', () => {
    expect(carriesOver(result(100, null, true, true))).toBe(false)
  })
})
