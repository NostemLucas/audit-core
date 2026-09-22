import { z } from 'zod'
import { Instant } from '../../../platform/http/index.js'
import { ReportType } from '../../../shared/enums.js'
import { LIMITS } from '../../../shared/limits.js'

/** Un informe generado (docs/07 §2). El archivo vive en Nextcloud; `downloadUrl` es un share de solo lectura, pedido
 * al vuelo (no se guarda: si el share expirara o se revocara, seguiría pudiendo generarse uno nuevo). */
export const ReportView = z.object({
  id: z.uuid(),
  type: z.enum(ReportType),
  title: z.string(),
  createdAt: Instant,
})

export const ReportWithDownload = ReportView.extend({ downloadUrl: z.url() })

export const GenerateReport = z.object({
  type: z.enum(ReportType).default('COMPLIANCE'),
  /** Por defecto, el nombre de la auditoría. */
  title: z.string().trim().min(1).max(LIMITS.name).optional(),
})
export type GenerateReportT = z.infer<typeof GenerateReport>

export const ReportId = z.uuid()
