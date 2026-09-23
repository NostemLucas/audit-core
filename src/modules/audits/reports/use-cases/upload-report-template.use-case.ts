import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import type { ReportType, ScaleDimension } from '../../../../shared/enums.js'
import { AuditErrors } from '../../domain/errors.js'
import { validateReportTemplate } from '../report-template-validation.js'

@Injectable()
export class UploadReportTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Sube (o reemplaza) la plantilla de un (type, dimension) — la más específica que exista se usa al generar
   * (docs/07 §2). Se valida ANTES de guardar: si el .docx no sirve, no se toca nada.
   *
   * Busca-y-crea-o-actualiza, no un `upsert` atómico: el comodín (`dimension: null`) no es un valor que Prisma deje
   * pasar por la clave compuesta de `upsert` (no es lo que declara el `@@unique`, aunque el índice parcial de la BD
   * sí lo garantice único). Es una operación de administración, poco frecuente; una carrera real entre dos subidas
   * para el mismo (type, dimension) cae en la restricción UNIQUE de la BD y llega como 409 genérico, no como 500
   * (`errors-catalog.spec.ts`, `UNMAPPED_UNIQUES`).
   */
  @Transactional()
  async execute(input: { type: ReportType; dimension: ScaleDimension | undefined; file: Buffer | undefined }) {
    if (!input.file || input.file.length === 0) {
      throw new DomainError(AuditErrors.REPORT_TEMPLATE_INVALID, { reason: 'Falta el archivo (campo "file")' })
    }
    const warnings = validateReportTemplate(input.file)
    const dimension = input.dimension ?? null
    // Uint8Array.from(...): el `Buffer` de Node está sobre un `ArrayBufferLike` (incluye `SharedArrayBuffer`), y el
    // tipo que genera Prisma para `Bytes` exige un `Uint8Array<ArrayBuffer>` estricto.
    const content = Uint8Array.from(input.file)

    const existing = await this.tx.reportTemplate.findFirst({
      where: { type: input.type, dimension },
      select: { id: true },
    })
    const template = existing
      ? await this.tx.reportTemplate.update({ where: { id: existing.id }, data: { content } })
      : await this.tx.reportTemplate.create({ data: { type: input.type, dimension, content } })

    return { template, warnings: warnings.map((w) => w.message) }
  }
}
