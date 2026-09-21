import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { LibraryErrors } from '../errors.js'
import { findScaleViolation, type LevelDraft } from './scale.rules.js'

/** Cómo se cargan las opciones: siempre por puntaje ascendente (el orden de una escala es el de su puntaje). */
export const WITH_LEVELS = { levels: { orderBy: { value: 'asc' as const } } }

export async function loadScale(tx: Tx, id: string) {
  const scale = await tx.scale.findUnique({ where: { id }, include: WITH_LEVELS })
  if (!scale) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id })
  return scale
}

/** Una escala usada por alguna auditoría no cambia de estructura (docs/01 §2.2). */
export async function assertStructureEditable(tx: Tx, scaleId: string): Promise<void> {
  const audits = await tx.audit.count({ where: { scaleId } })
  if (audits > 0) throw new DomainError(LibraryErrors.SCALE_STRUCTURE_LOCKED, { scaleId, audits })
}

/** Lanza SCALE_LEVELS_INVALID si el conjunto de opciones resultante incumple una invariante. */
export function assertLevelsValid(levels: readonly LevelDraft[]): void {
  const violation = findScaleViolation(levels)
  if (violation) throw new DomainError(LibraryErrors.SCALE_LEVELS_INVALID, { ...violation })
}
