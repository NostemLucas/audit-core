import { LIMITS } from '../../../../shared/limits.js'

/**
 * De un árbol de controles (ya parseado del YAML por `infrastructure/`) a un plan de nodos. Función PURA: no sabe de
 * YAML, de HTTP ni de la BD. Recibe la estructura ya como árbol (la anidación del YAML es la jerarquía: no hace falta
 * ninguna columna "nivel") y devuelve el plan o TODOS los errores del archivo (el usuario corrige el archivo una sola
 * vez, no un error por intento).
 */
export interface ImportControlNode {
  readonly reference?: string | null
  /** Ausente o vacío es un error (`Falta el título`), no un valor por defecto: lo valida `buildImportPlan`, no el YAML. */
  readonly title?: string | null
  readonly description?: string | null
  readonly controls?: readonly ImportControlNode[]
}

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
  /** Posición secuencial del control en el archivo (orden de lectura, 1-based), para los mensajes. */
  readonly row: number
  readonly message: string
}

export type ImportPlan =
  | { readonly ok: true; readonly nodes: readonly ImportNode[] }
  | { readonly ok: false; readonly issues: readonly ImportIssue[] }

function countNodes(children: readonly ImportControlNode[]): number {
  return children.reduce((sum, node) => sum + 1 + countNodes(node.controls ?? []), 0)
}

export function buildImportPlan(tree: readonly ImportControlNode[]): ImportPlan {
  if (tree.length === 0) return { ok: false, issues: [{ row: 0, message: 'El archivo no tiene ningún control' }] }
  if (countNodes(tree) > LIMITS.importRows) {
    return { ok: false, issues: [{ row: 0, message: `El archivo supera el máximo de ${LIMITS.importRows} controles` }] }
  }

  const issues: ImportIssue[] = []
  const nodes: ImportNode[] = []
  let position = 0

  const walk = (children: readonly ImportControlNode[], parentIndex: number | null, depth: number): void => {
    children.forEach((raw, siblingPosition) => {
      position += 1
      const at = position
      if (!raw.title?.trim()) issues.push({ row: at, message: 'Falta el título' })
      if (depth > LIMITS.controlDepth) {
        issues.push({ row: at, message: `El nivel ${depth} supera la profundidad máxima (${LIMITS.controlDepth})` })
      }
      const index = nodes.length
      nodes.push({
        index,
        parentIndex,
        reference: raw.reference ?? null,
        title: raw.title ?? '',
        description: raw.description ?? null,
        position: siblingPosition,
      })
      walk(raw.controls ?? [], index, depth + 1)
    })
  }
  walk(tree, null, 1)

  return issues.length > 0 ? { ok: false, issues: issues.sort((a, b) => a.row - b.row) } : { ok: true, nodes }
}
