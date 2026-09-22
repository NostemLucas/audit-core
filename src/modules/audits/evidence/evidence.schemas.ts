import { z } from 'zod'
import { ByteSize, Instant } from '../../../platform/http/index.js'

/** Una evidencia adjunta a un criterio (docs/07 §1). El archivo en sí vive en Nextcloud; esto es su metadato. */
export const EvidenceView = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  size: ByteSize,
  createdAt: Instant,
  /** Quién la subió: el auditor asignado al criterio en ese momento. Sin relación propia (docs/01, sellos sin FK). */
  createdById: z.uuid().nullable(),
})

/** La URL del share de solo-subida: el cliente habla directo con Nextcloud desde aquí (docs/07 §1.1). */
export const UploadTargetView = z.object({ url: z.url() })

/**
 * El contrato que este backend exige del webhook de Nextcloud (docs/07 §1.2; NO es un formato propio de Nextcloud,
 * lo configura quien administre el servidor con una regla de *Flow* que lo cumpla).
 */
export const NextcloudEvidenceWebhook = z.object({
  path: z.string().min(1),
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
})
export type NextcloudEvidenceWebhookT = z.infer<typeof NextcloudEvidenceWebhook>

export const EvidenceId = z.uuid()
