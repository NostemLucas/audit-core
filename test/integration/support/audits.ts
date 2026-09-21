import type { Db } from '../../../src/platform/db/index.js'
import { type SeedNode, seedControls } from './templates.js'

/** Dos dominios, cuatro hojas y ramas desiguales: lo mínimo para probar auditorías sobre una plantilla real. */
export const AUDIT_TREE: SeedNode[] = [
  {
    title: 'Organizacionales',
    reference: 'A.5',
    kids: [
      { title: 'Políticas', reference: 'A.5.1' },
      { title: 'Roles', reference: 'A.5.2' },
    ],
  },
  {
    title: 'Personas',
    reference: 'A.6',
    kids: [{ title: 'Selección', kids: [{ title: 'Antecedentes' }, { title: 'Contratos' }] }],
  },
]
export const LEAF_TITLES = ['Políticas', 'Roles', 'Antecedentes', 'Contratos']

/** Organización activa, plantilla PUBLICADA con su árbol y escala activa de conformidad. */
export async function libraryFixture(db: Db, suffix = '') {
  const organization = await db.organization.create({ data: { name: `ACME${suffix}` } })
  const template = await db.template.create({ data: { name: `ISO/IEC 27001${suffix}`, status: 'PUBLISHED' } })
  await seedControls(db, template.id, AUDIT_TREE)
  const scale = await db.scale.create({
    data: {
      name: `Conformidad${suffix}`,
      dimension: 'CONFORMITY',
      levels: {
        create: [
          { value: 0, label: 'No cumple' },
          { value: 50, label: 'Parcial' },
          { value: 100, label: 'Cumple' },
        ],
      },
    },
    include: { levels: { orderBy: { value: 'asc' } } },
  })
  const controls = await db.control.findMany({ where: { templateId: template.id } })
  return { organization, template, scale, controls, leaves: controls.filter((c) => LEAF_TITLES.includes(c.title)) }
}
export type LibraryFixture = Awaited<ReturnType<typeof libraryFixture>>

/** El cuerpo mínimo válido para crear una auditoría con esa biblioteca. */
export const auditBody = (f: LibraryFixture, extra: Record<string, unknown> = {}) => ({
  name: 'Auditoría ISO 27001',
  templateId: f.template.id,
  organizationId: f.organization.id,
  scaleId: f.scale.id,
  ...extra,
})
