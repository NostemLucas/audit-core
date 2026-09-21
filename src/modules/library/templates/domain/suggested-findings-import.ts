import { LIMITS } from '../../../../shared/limits.js'
import { normalizeLabel } from '../../scales/scale.rules.js'
import type { ImportIssue } from './control-import.js'

/**
 * De una matriz de Excel (una fila por control, una columna por opción de la escala) a las sugerencias que hay que
 * guardar. Función PURA: no sabe de Excel, HTTP ni la BD. Reúne TODOS los errores del archivo (con su fila), igual que la
 * importación de plantillas. Solo agrega o cambia: una celda vacía NO borra (borrar es explícito, con DELETE).
 */
export interface LevelRef {
  readonly id: string
  readonly value: number
  readonly label: string
}

export interface HeaderCell {
  readonly column: number
  readonly header: string
}

export interface MatrixRow {
  readonly row: number
  /** Lo que trae la columna ID (el id del control tal como lo exportó el sistema). */
  readonly controlId: string | undefined
  /** Las celdas con texto de todas las demás columnas (las que no son de una opción se ignoran). */
  readonly cells: ReadonlyArray<{ readonly column: number; readonly text: string }>
}

export interface SuggestedCell {
  readonly controlId: string
  readonly levelId: string
  readonly text: string
}

/** Cabeceras que el sistema escribe al exportar y que no son opciones de la escala: se ignoran sin avisar. */
const IDENTIFYING_HEADERS = new Set(['id', 'id (sistema)', 'dominio', 'referencia', 'control', 'título', 'titulo'])

/** "50 – Parcial", "0 - No cumple", "2.5: Definido": el puntaje al inicio, luego un separador y la etiqueta. */
const LEVEL_HEADER = /^(\d+(?:[.,]\d+)?)\s*[-–—:]\s*\S/

export function levelHeader(level: Pick<LevelRef, 'value' | 'label'>): string {
  return `${level.value} – ${level.label}`
}

export interface ColumnMatch {
  readonly levelByColumn: ReadonlyMap<number, string>
  /** Cabeceras que no son ni del sistema ni de una opción: se informan como aviso. */
  readonly ignored: readonly string[]
  readonly issues: readonly ImportIssue[]
}

/** Relaciona cada columna con una opción de la escala: por su puntaje ("50 – Parcial") o, si no, por su etiqueta. */
export function matchLevelColumns(headers: readonly HeaderCell[], levels: readonly LevelRef[]): ColumnMatch {
  const byValue = new Map(levels.map((level) => [level.value, level]))
  const byLabel = new Map(levels.map((level) => [normalizeLabel(level.label), level]))
  const levelByColumn = new Map<number, string>()
  const columnOfLevel = new Map<string, number>()
  const ignored: string[] = []
  const issues: ImportIssue[] = []

  for (const { column, header } of headers) {
    const text = header.trim()
    if (IDENTIFYING_HEADERS.has(text.toLowerCase())) continue
    const numeric = LEVEL_HEADER.exec(text)
    const level = (numeric && byValue.get(Number(numeric[1]!.replace(',', '.')))) ?? byLabel.get(normalizeLabel(text))
    if (!level) {
      ignored.push(text)
      continue
    }
    const earlier = columnOfLevel.get(level.id)
    if (earlier !== undefined) {
      issues.push({
        row: 1,
        message: `Las columnas ${earlier} y ${column} corresponden a la misma opción ("${level.label}")`,
      })
      continue
    }
    columnOfLevel.set(level.id, column)
    levelByColumn.set(column, level.id)
  }
  if (levelByColumn.size === 0 && issues.length === 0) {
    issues.push({
      row: 1,
      message: 'No se reconoció ninguna columna de opción de la escala elegida (cabeceras como "50 – Parcial")',
    })
  }
  return { levelByColumn, ignored, issues }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SuggestedImportPlan =
  | { readonly ok: true; readonly cells: readonly SuggestedCell[] }
  | { readonly ok: false; readonly issues: readonly ImportIssue[] }

export function planSuggestedImport(
  rows: readonly MatrixRow[],
  levelByColumn: ReadonlyMap<number, string>,
  leafIds: ReadonlySet<string>,
): SuggestedImportPlan {
  if (rows.length > LIMITS.importRows) {
    return { ok: false, issues: [{ row: 0, message: `El archivo supera el máximo de ${LIMITS.importRows} filas` }] }
  }
  const issues: ImportIssue[] = []
  const seen = new Map<string, number>()
  const cells: SuggestedCell[] = []

  for (const raw of rows) {
    const texts = raw.cells.filter((cell) => levelByColumn.has(cell.column))
    if (texts.length === 0) continue // sin texto en ninguna opción: nada que guardar (y nada que exigir)

    const id = raw.controlId?.toLowerCase()
    if (!id) {
      issues.push({ row: raw.row, message: 'Falta el ID del control (columna "ID": no la borres ni la modifiques)' })
      continue
    }
    if (!UUID.test(id) || !leafIds.has(id)) {
      issues.push({ row: raw.row, message: 'El ID no corresponde a un control evaluable de esta plantilla' })
      continue
    }
    const first = seen.get(id)
    if (first !== undefined) {
      issues.push({ row: raw.row, message: `El control ya aparece en la fila ${first}` })
      continue
    }
    seen.set(id, raw.row)

    for (const { column, text } of texts) {
      if (text.length > LIMITS.text) {
        issues.push({ row: raw.row, message: `El texto de la columna ${column} supera los ${LIMITS.text} caracteres` })
        continue
      }
      cells.push({ controlId: id, levelId: levelByColumn.get(column)!, text })
    }
  }
  return issues.length > 0 ? { ok: false, issues: issues.sort((a, b) => a.row - b.row) } : { ok: true, cells }
}
