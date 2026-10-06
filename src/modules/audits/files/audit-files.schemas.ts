import { z } from 'zod'
import { Instant } from '../../../platform/http/index.js'

/** Las dos carpetas de una auditoría que el equipo navega en Nextcloud (docs/07 §1.5). */
export const AuditFileSection = z.enum(['EVIDENCIA', 'INFORMES'])
export type AuditFileSectionT = z.infer<typeof AuditFileSection>

/**
 * `path` es relativa a la sección (vacía = la raíz de la sección). Se valida segmento por segmento: nada de `..`,
 * `.` ni rutas absolutas, así que no hay forma de salir de la carpeta de la auditoría.
 */
export const ListAuditFilesQuery = z.object({
  section: AuditFileSection.default('EVIDENCIA'),
  path: z
    .string()
    .max(500)
    .default('')
    .refine(
      (p) =>
        p
          .split('/')
          .every((segment) => segment === '' || (segment !== '.' && segment !== '..' && !segment.includes('\\'))),
      'Ruta no válida',
    ),
})
export type ListAuditFilesQueryT = z.infer<typeof ListAuditFilesQuery>

export const AuditFileEntry = z.object({
  name: z.string(),
  path: z.string(),
  isFolder: z.boolean(),
  size: z.number().int().nullable(),
  mimeType: z.string().nullable(),
  modifiedAt: Instant.nullable(),
})

/** Lo que se muestra al navegar: la carpeta actual y sus hijos. `path` vuelve normalizada para el breadcrumb. */
export const ListAuditFilesView = z.object({
  section: AuditFileSection,
  path: z.string(),
  entries: z.array(AuditFileEntry),
})
