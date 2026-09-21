import { z } from 'zod'
import { Instant } from '../../../platform/http/index.js'
import { TemplateStatus } from '../../../shared/enums.js'
import { LIMITS } from '../../../shared/limits.js'
import { TEMPLATE_EVENTS } from './domain/template.lifecycle.js'

const Name = z.string().trim().min(1).max(LIMITS.name)

export const TemplateView = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(TemplateStatus),
  /** Lo que el ciclo de vida permite hacer ahora. Estructural: no incluye permisos (el frontend ya tiene las reglas CASL) ni precondiciones. */
  allowedActions: z.array(z.enum(TEMPLATE_EVENTS)),
  controlCount: z.int(),
  createdAt: Instant,
  updatedAt: Instant,
})

/**
 * Importar (multipart). `file` se documenta aquí para que el OpenAPI lo muestre como archivo, pero NO se valida aquí: multer
 * lo entrega aparte (`@UploadedFile()`), no en el cuerpo. El nombre puede venir en el formulario o en la hoja "Plantilla".
 */
export const ImportTemplateBody = z.object({
  file: z
    .any()
    .meta({
      type: 'string',
      format: 'binary',
      description: 'Libro de Excel (.xlsx). Obligatorio: sin él la respuesta es 422.',
    })
    .optional(),
  name: Name.optional(),
})
export type ImportTemplateBodyT = z.infer<typeof ImportTemplateBody>

export const ImportTemplateResult = z.object({
  template: TemplateView,
  /** Lo que se ignoró o se interpretó del formato anterior; no impide la importación. */
  warnings: z.array(z.string()),
})

export const CreateTemplate = z.object({ name: Name })
export type CreateTemplateT = z.infer<typeof CreateTemplate>

export const UpdateTemplate = z.object({ name: Name })
export type UpdateTemplateT = z.infer<typeof UpdateTemplate>

export const ListTemplatesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(LIMITS.name).optional(),
  status: z.enum(TemplateStatus).optional(),
})
export type ListTemplatesQueryT = z.infer<typeof ListTemplatesQuery>

export const TemplateId = z.uuid()
