/**
 * El árbol de controles de UNA plantilla, en un solo lugar. Función pura: recibe la lista plana que sale de la BD y
 * responde qué es hoja, cuál es el dominio (el primer nivel) y cuál es la ruta de cada nodo.
 *
 * Reemplaza al `startsWith` sobre el código (gráficos) y al `extractDomain` (análisis de brechas) del proyecto anterior,
 * que dejaban dominios vacíos o inconsistentes con COBIT (`APO` → `APO01.01`) o ASFI (`Art. 5`). Aquí la jerarquía sale
 * SOLO de `parentId`: la referencia (`A.5.1`, `Art. 5`…) es texto libre y no interviene en nada.
 *
 * Hermanos ordenados por `position` (y por `id` si empataran, para que el orden sea siempre el mismo).
 */
export interface ControlNode {
  readonly id: string
  readonly parentId: string | null
  readonly position: number
}

const bySiblingOrder = (a: ControlNode, b: ControlNode): number => a.position - b.position || a.id.localeCompare(b.id)

export class ControlTree<N extends ControlNode = ControlNode> {
  private readonly byId = new Map<string, N>()
  private readonly children = new Map<string | null, N[]>()
  private readonly depths = new Map<string, number>()
  private readonly reading: N[] = []

  /** Lanza `Error` si los datos son incoherentes (padre inexistente o ciclo): es corrupción, no un caso de usuario. */
  constructor(nodes: readonly N[]) {
    for (const node of nodes) {
      if (this.byId.has(node.id)) throw new Error(`Control duplicado en el árbol: ${node.id}`)
      this.byId.set(node.id, node)
    }
    for (const node of nodes) {
      if (node.parentId !== null && !this.byId.has(node.parentId)) {
        throw new Error(`El control ${node.id} apunta a un padre inexistente (${node.parentId})`)
      }
      const siblings = this.children.get(node.parentId)
      if (siblings) siblings.push(node)
      else this.children.set(node.parentId, [node])
    }
    for (const siblings of this.children.values()) siblings.sort(bySiblingOrder)

    // Recorrido en orden de lectura (profundidad primero). Sin recursión: una norma puede ser profunda.
    const stack: Array<{ node: N; depth: number }> = [...this.rootNodes()].reverse().map((node) => ({ node, depth: 0 }))
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!
      this.depths.set(node.id, depth)
      this.reading.push(node)
      const kids = this.children.get(node.id) ?? []
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i]!, depth: depth + 1 })
    }
    if (this.reading.length !== nodes.length) throw new Error('El árbol de controles contiene un ciclo')
  }

  get size(): number {
    return this.byId.size
  }

  private rootNodes(): readonly N[] {
    return this.children.get(null) ?? []
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  private node(id: string): N {
    const node = this.byId.get(id)
    if (!node) throw new Error(`Control inexistente en el árbol: ${id}`)
    return node
  }

  /** Los dominios: el primer nivel, en orden. */
  roots(): readonly N[] {
    return this.rootNodes()
  }

  childrenOf(id: string | null): readonly N[] {
    return this.children.get(id) ?? []
  }

  isLeaf(id: string): boolean {
    this.node(id)
    return (this.children.get(id) ?? []).length === 0
  }

  /** Nivel del nodo: 0 para un dominio. */
  depthOf(id: string): number {
    this.node(id)
    return this.depths.get(id)!
  }

  /** Cadena desde el dominio hasta el nodo, ambos incluidos. */
  pathTo(id: string): readonly N[] {
    const path: N[] = []
    for (let current: N | undefined = this.node(id); current;) {
      path.push(current)
      current = current.parentId === null ? undefined : this.byId.get(current.parentId)
    }
    return path.reverse()
  }

  /** El dominio (nodo de primer nivel) al que pertenece el nodo; el propio nodo si es un dominio. */
  rootOf(id: string): N {
    return this.pathTo(id)[0]!
  }

  /** Todos los nodos en orden de lectura (padre antes que sus hijos, hermanos por posición). */
  readingOrder(): readonly N[] {
    return this.reading
  }

  /** Lo que se evalúa: los nodos sin hijos, en orden de lectura. */
  leaves(): readonly N[] {
    return this.reading.filter((node) => (this.children.get(node.id) ?? []).length === 0)
  }

  /** Dominios sin hijos: una plantilla no se publica con ellos (un dominio es un agrupador). */
  childlessRoots(): readonly N[] {
    return this.rootNodes().filter((root) => (this.children.get(root.id) ?? []).length === 0)
  }

  /** Nivel más profundo (0 si solo hay dominios; -1 si el árbol está vacío). */
  maxDepth(): number {
    let max = -1
    for (const depth of this.depths.values()) if (depth > max) max = depth
    return max
  }

  /** Ids del nodo y de todos sus descendientes. */
  subtreeIds(id: string): string[] {
    const ids: string[] = []
    const pending = [this.node(id)]
    for (let node = pending.pop(); node; node = pending.pop()) {
      ids.push(node.id)
      pending.push(...(this.children.get(node.id) ?? []))
    }
    return ids
  }

  /** ¿Mover `id` bajo `newParentId` crearía un ciclo? (bajo sí mismo o bajo uno de sus descendientes). */
  wouldCreateCycle(id: string, newParentId: string | null): boolean {
    if (newParentId === null) return false
    return this.subtreeIds(id).includes(newParentId)
  }

  /** Profundidad que tendría el subárbol de `id` si se moviera bajo `newParentId` (`null` = a primer nivel). */
  depthAfterMove(id: string, newParentId: string | null): number {
    const base = newParentId === null ? 0 : this.depthOf(newParentId) + 1
    const height = Math.max(...this.subtreeIds(id).map((n) => this.depthOf(n) - this.depthOf(id)))
    return base + height
  }
}

/**
 * Nuevo orden de una lista de hermanos al colocar `id` en `index` (0 = primero; fuera de rango se acota). Si `id` no
 * estaba entre ellos (viene de otro padre o es nuevo) se inserta. Devuelve los ids en su orden final: quien persiste
 * reescribe `position = índice`.
 */
export function placeAmong(siblingIds: readonly string[], id: string, index: number): string[] {
  const others = siblingIds.filter((sibling) => sibling !== id)
  const at = Math.max(0, Math.min(index, others.length))
  return [...others.slice(0, at), id, ...others.slice(at)]
}
