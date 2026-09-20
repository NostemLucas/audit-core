/**
 * Invariantes de una escala que la BD no puede expresar (entre varias filas). Función PURA: no conoce Nest, Prisma ni
 * HTTP. Se evalúa sobre el conjunto de opciones que QUEDARÍA tras el cambio (alta, edición o baja), nunca sobre el
 * actual. Reemplaza a los antiguos tipos RANGE / BINARY / QUALITATIVE (docs/01 §2.2).
 *
 * No hay regla de "máximo > 0": con 2 puntajes distintos y ninguno negativo (CHECK de la BD) el máximo siempre lo es, y
 * ya no se divide entre él.
 */
export interface LevelDraft {
  readonly value: number
  readonly label: string
}

export type ScaleRule = 'MIN_LEVELS' | 'DUPLICATE_VALUE' | 'DUPLICATE_LABEL'

export interface ScaleViolation {
  readonly rule: ScaleRule
  /** Qué chocó (el puntaje o la etiqueta repetidos), para que el mensaje al usuario sea concreto. */
  readonly offending?: number | string
}

export const MIN_LEVELS = 2

/** Dos etiquetas son la misma si solo difieren en mayúsculas o espacios ("No  cumple" = "no cumple"). */
export const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** La primera regla incumplida, o `undefined` si la escala es válida. */
export function findScaleViolation(levels: readonly LevelDraft[]): ScaleViolation | undefined {
  if (levels.length < MIN_LEVELS) return { rule: 'MIN_LEVELS' }

  const values = new Set<number>()
  for (const { value } of levels) {
    if (values.has(value)) return { rule: 'DUPLICATE_VALUE', offending: value }
    values.add(value)
  }

  const labels = new Set<string>()
  for (const { label } of levels) {
    const key = normalizeLabel(label)
    if (labels.has(key)) return { rule: 'DUPLICATE_LABEL', offending: label }
    labels.add(key)
  }

  return undefined
}
