import type { ScaleDimension } from '../../../shared/enums.js'

/**
 * Qué exige enviar un criterio a revisión (docs/06 §3). Función PURA: solo compara puntajes; no sabe de BD ni de Nest.
 */
export interface LevelRef {
  readonly value: number
}

/** ¿Hace falta un hallazgo escrito? El nivel alcanzado queda por debajo del esperado. */
export function requiresFindings(expected: LevelRef, achieved: LevelRef): boolean {
  return achieved.value < expected.value
}

/**
 * ¿Hace falta evidencia? El nivel alcanzado supera el MÍNIMO de la escala: para decir que algo cumple hay que
 * demostrarlo. El mínimo no la exige porque ahí el hallazgo ES la ausencia ("se pidió y no existe"). No configurable.
 */
export function requiresEvidence(achieved: LevelRef, minimum: LevelRef): boolean {
  return achieved.value > minimum.value
}

/**
 * ¿Hace falta clasificar la gravedad? Solo cuando además hace falta hallazgo (misma condición que `requiresFindings`)
 * Y la escala es de conformidad: ahí la gravedad tiene una consecuencia real (una mayor puede bloquear una
 * certificación). En capacidad es libre — el auditor la pone si quiere, nunca es obligatoria (docs/06 §3).
 */
export function requiresSeverity(expected: LevelRef, achieved: LevelRef, dimension: ScaleDimension): boolean {
  return dimension === 'CONFORMITY' && requiresFindings(expected, achieved)
}

export type MissingRequirement =
  'ACHIEVED_LEVEL_OR_NOT_APPLICABLE' | 'NOT_APPLICABLE_REASON' | 'FINDINGS' | 'SEVERITY' | 'EVIDENCE'

export interface CompletionInput {
  readonly achievedLevelId: string | null
  readonly isNotApplicable: boolean
  readonly notApplicableReason: string | null
  readonly findings: string | null
  readonly severity: string | null
}

export interface CompletionLevels {
  readonly expected: LevelRef
  /** `null` si no hay nivel alcanzado (entonces falta ACHIEVED_LEVEL_OR_NOT_APPLICABLE, salvo que sea N/A). */
  readonly achieved: LevelRef | null
  readonly minimum: LevelRef
}

/** Lo que falta para poder enviar el criterio, en orden. Vacío = se puede enviar. */
export function missingForCompletion(
  input: CompletionInput,
  levels: CompletionLevels,
  evidenceCount: number,
  dimension: ScaleDimension,
): readonly MissingRequirement[] {
  if (input.isNotApplicable) {
    // N/A no exige nada más: ni nivel alcanzado, ni hallazgo, ni gravedad, ni evidencia.
    return input.notApplicableReason ? [] : ['NOT_APPLICABLE_REASON']
  }
  if (!input.achievedLevelId || !levels.achieved) return ['ACHIEVED_LEVEL_OR_NOT_APPLICABLE']

  const missing: MissingRequirement[] = []
  if (requiresFindings(levels.expected, levels.achieved) && !input.findings) missing.push('FINDINGS')
  if (requiresSeverity(levels.expected, levels.achieved, dimension) && !input.severity) missing.push('SEVERITY')
  if (requiresEvidence(levels.achieved, levels.minimum) && evidenceCount === 0) missing.push('EVIDENCE')
  return missing
}
