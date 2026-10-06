import { z } from 'zod'
import { Instant } from '../../../platform/http/index.js'
import { ReportType, ScaleDimension } from '../../../shared/enums.js'

export const ReportTemplateView = z.object({
  id: z.uuid(),
  type: z.enum(ReportType),
  /** `null` = comodín: aplica a cualquier escala de ese tipo (docs/07 §2). */
  scaleId: z.uuid().nullable(),
  /** La escala a la que aplica, para mostrarla sin otra consulta. `null` si es comodín. */
  scale: z.object({ id: z.uuid(), name: z.string(), dimension: z.enum(ScaleDimension) }).nullable(),
  createdAt: Instant,
  updatedAt: Instant,
})

/**
 * `type` y `scaleId` van en la query, `file` en el cuerpo multipart (`@UploadedFile()`). Subir reemplaza la que ya
 * hubiera para ese (type, escala) — no se versiona (docs/07 §2).
 */
export const UploadReportTemplateQuery = z.object({
  type: z.enum(ReportType),
  /** Sin indicarla = comodín (aplica a cualquier escala de ese tipo). */
  scaleId: z.uuid().optional(),
})
export type UploadReportTemplateQueryT = z.infer<typeof UploadReportTemplateQuery>

/** `file` se documenta aquí para que el OpenAPI lo muestre como archivo; multer lo entrega aparte, no en el cuerpo. */
export const UploadReportTemplateBody = z.object({
  file: z
    .any()
    .meta({
      type: 'string',
      format: 'binary',
      description: 'Plantilla .docx. Obligatorio: sin ella la respuesta es 422.',
    })
    .optional(),
})
export type UploadReportTemplateBodyT = z.infer<typeof UploadReportTemplateBody>

export const UploadReportTemplateResult = z.object({
  template: ReportTemplateView,
  /** No bloquean (p. ej. falta el marcador de imagen del gráfico): la plantilla igual se guardó. */
  warnings: z.array(z.string()),
})

export const ReportTemplateId = z.uuid()
