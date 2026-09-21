import type { Db } from '../../../src/platform/db/index.js'

export interface SeedNode {
  readonly title: string
  readonly reference?: string
  readonly description?: string
  readonly kids?: readonly SeedNode[]
}

/** Inserta un árbol de controles directamente en la BD (rápido); la posición sale del orden de escritura. */
export async function seedControls(
  db: Db,
  templateId: string,
  spec: readonly SeedNode[],
  parentId: string | null = null,
): Promise<void> {
  for (const [position, node] of spec.entries()) {
    const row = await db.control.create({
      data: {
        templateId,
        parentId,
        title: node.title,
        position,
        reference: node.reference ?? null,
        description: node.description ?? null,
      },
    })
    if (node.kids) await seedControls(db, templateId, node.kids, row.id)
  }
}
