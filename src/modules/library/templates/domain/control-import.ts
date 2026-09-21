import { LIMITS } from '../../../../shared/limits.js'

/**
 * De las filas de un archivo a un árbol de controles. Función PURA: no sabe de Excel (eso es `infrastructure/`), de HTTP
 * ni de la BD. Recibe las celdas ya normalizadas a texto y devuelve el plan de nodos o TODOS los errores por fila (el
 * usuario corrige el archivo una sola vez, no un error por intento).
 *
 * Dos formas de decir el padre:
 *  - `level` (la actual): una columna `nivel` y las filas en orden de lectura; el padre de una fila es la fila anterior de
 *    nivel menor. Es lo único que no depende de las referencias, que son texto libre.
 *  - `parent-reference` (archivos del proyecto anterior): una columna `código padre`. Se resuelve SOLO dentro del archivo y
 *    exige referencias únicas; no se conserva ninguna lógica sobre ellas después.
 */
export interface RawRow {
  /** Número de fila en la hoja (para los mensajes). */
  readonly row: number
  readonly level?: string | undefined
  readonly reference?: string | undefined
  readonly title?: string | undefined
  readonly description?: string | undefined
  readonly parentReference?: string | undefined
}

export type ImportMode = 'level' | 'parent-reference'

export interface ImportNode {
  /** Posición en el plan (orden de lectura: un padre siempre antes que sus hijos). */
  readonly index: number
  readonly parentIndex: number | null
  readonly reference: string | null
  readonly title: string
  readonly description: string | null
  /** Lugar entre sus hermanos, desde 0. */
  readonly position: number
}

export interface ImportIssue {
  readonly row: number
  readonly message: string
}

export type ImportPlan =
  | { readonly ok: true; readonly nodes: readonly ImportNode[] }
  | { readonly ok: false; readonly issues: readonly ImportIssue[] }

/** Los valores que en un archivo de este proyecto significan "sin padre" (`-` es lo que escribía la exportación anterior). */
const NO_PARENT = new Set(['', '-'])

export function buildImportPlan(rows: readonly RawRow[], mode: ImportMode): ImportPlan {
  if (rows.length === 0)
    return { ok: false, issues: [{ row: 0, message: 'El archivo no tiene ninguna fila de controles' }] }
  if (rows.length > LIMITS.importRows) {
    return { ok: false, issues: [{ row: 0, message: `El archivo supera el máximo de ${LIMITS.importRows} filas` }] }
  }
  const issues: ImportIssue[] = []
  for (const row of rows) {
    if (!row.title) issues.push({ row: row.row, message: 'Falta el título' })
  }
  const nodes = mode === 'level' ? planByLevel(rows, issues) : planByParentReference(rows, issues)
  return issues.length > 0 ? { ok: false, issues: issues.sort((a, b) => a.row - b.row) } : { ok: true, nodes }
}

function planByLevel(rows: readonly RawRow[], issues: ImportIssue[]): ImportNode[] {
  const nodes: ImportNode[] = []
  /** stack[d] = índice del último nodo visto en el nivel d (base 0). */
  const stack: number[] = []
  const siblingCount = new Map<number | null, number>()
  let previous = 0

  for (const raw of rows) {
    const level = parseLevel(raw.level)
    if (level === undefined) {
      issues.push({ row: raw.row, message: `Nivel inválido: "${raw.level ?? ''}" (debe ser un entero desde 1)` })
      continue
    }
    if (level > previous + 1) {
      issues.push({
        row: raw.row,
        message: `El nivel salta de ${previous} a ${level}: cada fila puede bajar como máximo un nivel más que la anterior`,
      })
      continue
    }
    if (level > LIMITS.controlDepth) {
      issues.push({ row: raw.row, message: `El nivel ${level} supera la profundidad máxima (${LIMITS.controlDepth})` })
      continue
    }
    previous = level
    stack.length = level - 1
    const parentIndex = level === 1 ? null : stack[level - 2]!
    const position = siblingCount.get(parentIndex) ?? 0
    siblingCount.set(parentIndex, position + 1)

    const index = nodes.length
    stack[level - 1] = index
    nodes.push(toNode(raw, index, parentIndex, position))
  }
  return nodes
}

function planByParentReference(rows: readonly RawRow[], issues: ImportIssue[]): ImportNode[] {
  const byReference = new Map<string, number>()
  rows.forEach((raw, i) => {
    if (!raw.reference) return
    const first = byReference.get(raw.reference)
    if (first !== undefined) {
      issues.push({
        row: raw.row,
        message: `La referencia "${raw.reference}" ya se usó en la fila ${rows[first]!.row}: con "código padre" debe ser única`,
      })
    } else byReference.set(raw.reference, i)
  })

  /** parent[i] = índice de fila del padre, o null. */
  const parent: Array<number | null> = rows.map((raw) => {
    const ref = raw.parentReference ?? ''
    if (NO_PARENT.has(ref)) return null
    const found = byReference.get(ref)
    if (found === undefined) issues.push({ row: raw.row, message: `El padre "${ref}" no existe en el archivo` })
    return found ?? null
  })
  if (issues.length > 0) return []

  const children = new Map<number | null, number[]>()
  parent.forEach((p, i) => children.set(p, [...(children.get(p) ?? []), i]))

  const nodes: ImportNode[] = []
  const emitted = new Map<number, number>() // fila → índice en el plan
  const stack: Array<{ row: number; depth: number }> = (children.get(null) ?? [])
    .map((row) => ({ row, depth: 1 }))
    .reverse()
  while (stack.length > 0) {
    const { row, depth } = stack.pop()!
    if (depth > LIMITS.controlDepth) {
      issues.push({ row: rows[row]!.row, message: `Supera la profundidad máxima (${LIMITS.controlDepth})` })
      continue
    }
    const p = parent[row] ?? null
    const siblings = children.get(p) ?? []
    const index = nodes.length
    emitted.set(row, index)
    nodes.push(toNode(rows[row]!, index, p === null ? null : emitted.get(p)!, siblings.indexOf(row)))
    const kids = children.get(row) ?? []
    for (let k = kids.length - 1; k >= 0; k--) stack.push({ row: kids[k]!, depth: depth + 1 })
  }
  if (issues.length === 0 && nodes.length !== rows.length) {
    // Filas sin alcanzar desde ningún nodo sin padre: forman un ciclo.
    rows.forEach((raw, i) => {
      if (!emitted.has(i)) issues.push({ row: raw.row, message: 'Forma parte de un ciclo de padres' })
    })
  }
  return nodes
}

function toNode(raw: RawRow, index: number, parentIndex: number | null, position: number): ImportNode {
  return {
    index,
    parentIndex,
    reference: raw.reference ?? null,
    title: raw.title ?? '',
    description: raw.description ?? null,
    position,
  }
}

/** "2", "2.0" y 2 son el nivel 2; "1.5", "0", "-1", "a" y "" no lo son. */
function parseLevel(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+(\.0+)?$/.test(text.trim())) return undefined
  const level = Number(text)
  return Number.isInteger(level) && level >= 1 ? level : undefined
}
