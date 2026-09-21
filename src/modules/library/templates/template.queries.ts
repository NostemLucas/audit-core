import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { TemplateStatus } from '../../../shared/enums.js'
import { LibraryErrors } from '../errors.js'
import { ControlTree, placeAmong } from './domain/control-tree.js'
import { templateLifecycle } from './domain/template.lifecycle.js'

export const WITH_CONTROL_COUNT = { _count: { select: { controls: true } } } as const

/** Un resultado de plantilla con lo derivado que el cliente necesita (acciones posibles y cantidad de controles). */
export function withActions<T extends { status: TemplateStatus; _count: { controls: number } }>(row: T) {
  const { _count, ...rest } = row
  return { ...rest, controlCount: _count.controls, allowedActions: templateLifecycle.allowed(row.status) }
}

export async function loadTemplate(tx: Tx, id: string) {
  const template = await tx.template.findUnique({ where: { id }, include: WITH_CONTROL_COUNT })
  if (!template) throw new DomainError(LibraryErrors.TEMPLATE_NOT_FOUND, { id })
  return template
}

export function loadControls(tx: Tx, templateId: string) {
  return tx.control.findMany({ where: { templateId } })
}

/** La lista plana de controles en orden de lectura, con nivel y si es hoja. */
export async function listControls(tx: Tx, templateId: string) {
  return controlViews(await loadControls(tx, templateId))
}

export function controlViews<N extends { id: string; parentId: string | null; position: number }>(rows: readonly N[]) {
  const tree = new ControlTree(rows)
  return tree.readingOrder().map((row) => ({ ...row, depth: tree.depthOf(row.id), isLeaf: tree.isLeaf(row.id) }))
}

/**
 * Deja a los hermanos en el orden dado, con `position` = su índice. Solo escribe los que cambian. `current` trae las
 * posiciones que hay hoy en la BD.
 */
export async function writeOrder(
  tx: Tx,
  order: readonly string[],
  current: ReadonlyMap<string, number>,
): Promise<void> {
  for (const [index, id] of order.entries()) {
    if (current.get(id) !== index) await tx.control.update({ where: { id }, data: { position: index } })
  }
}

/** Atajo: coloca `id` en `index` entre los hijos de `parentId` y persiste el nuevo orden. */
export async function placeInParent(
  tx: Tx,
  tree: ControlTree,
  parentId: string | null,
  id: string,
  index: number,
  positions: ReadonlyMap<string, number>,
): Promise<void> {
  await writeOrder(
    tx,
    placeAmong(
      tree.childrenOf(parentId).map((n) => n.id),
      id,
      index,
    ),
    positions,
  )
}
