import { describe, expect, it } from 'vitest'
import { findScaleViolation, normalizeLabel } from './scale.rules.js'

const level = (value: number, label: string) => ({ value, label })

describe('findScaleViolation', () => {
  it.each([
    ['binaria (2 opciones)', [level(0, 'No cumple'), level(100, 'Cumple')]],
    ['conformidad con parcial', [level(0, 'No cumple'), level(50, 'Parcial'), level(100, 'Cumple')]],
    ['madurez 0–5 (incluye el 0)', [0, 1, 2, 3, 4, 5].map((n) => level(n, `Nivel ${n}`))],
    ['sin cero ni consecutividad', [level(1, 'Bajo'), level(3, 'Medio'), level(10, 'Alto')]],
    ['decimales', [level(0.5, 'a'), level(2.25, 'b')]],
  ])('%s: es válida', (_caso, levels) => {
    expect(findScaleViolation(levels)).toBeUndefined()
  })

  it('MIN_LEVELS: menos de 2 opciones (incluida la lista vacía)', () => {
    expect(findScaleViolation([])).toEqual({ rule: 'MIN_LEVELS' })
    expect(findScaleViolation([level(1, 'Única')])).toEqual({ rule: 'MIN_LEVELS' })
  })

  it('DUPLICATE_VALUE: dos opciones con el mismo puntaje, con el puntaje repetido', () => {
    expect(findScaleViolation([level(1, 'a'), level(2, 'b'), level(1, 'c')])).toEqual({
      rule: 'DUPLICATE_VALUE',
      offending: 1,
    })
  })

  it('DUPLICATE_LABEL: mismas etiquetas salvo mayúsculas o espacios', () => {
    expect(findScaleViolation([level(0, 'No cumple'), level(1, '  no   CUMPLE ')])).toEqual({
      rule: 'DUPLICATE_LABEL',
      offending: '  no   CUMPLE ',
    })
  })

  it('etiquetas que solo se parecen (tildes, otra palabra) NO son duplicadas', () => {
    expect(findScaleViolation([level(0, 'Definido'), level(1, 'Definído')])).toBeUndefined()
  })

  it('las reglas se evalúan en un orden fijo (la primera incumplida es la que se informa)', () => {
    // una sola opción: incumple MIN_LEVELS y nada más; una lista vacía, igual
    expect(findScaleViolation([level(0, 'a')])?.rule).toBe('MIN_LEVELS')
    // duplicado de puntaje y de etiqueta a la vez: gana el puntaje
    expect(findScaleViolation([level(1, 'a'), level(1, 'A')])?.rule).toBe('DUPLICATE_VALUE')
  })
})

describe('normalizeLabel', () => {
  it('recorta, junta espacios y pasa a minúsculas', () => {
    expect(normalizeLabel('  No   Cumple ')).toBe('no cumple')
  })
})
