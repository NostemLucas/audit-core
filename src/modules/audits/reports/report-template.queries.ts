import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import type { ReportType } from '../../../shared/enums.js'
import { AuditErrors } from '../domain/errors.js'

/**
 * La plantilla personalizada que aplica para generar un informe de este tipo y esta escala (docs/07 §2): la más
 * específica gana. `null` si no hay ninguna (se usa la de fábrica). `findFirst`, no `findUnique`: el comodín
 * (`scaleId: null`) no es un valor que la clave compuesta de Prisma resuelva de forma directa, y el índice único
 * parcial de la BD ya garantiza que como mucho hay una fila por cada caso.
 */
export async function findReportTemplate(tx: Tx, type: ReportType, scaleId: string): Promise<Buffer | null> {
  const exact = await tx.reportTemplate.findFirst({ where: { type, scaleId }, select: { content: true } })
  if (exact) return Buffer.from(exact.content)
  const wildcard = await tx.reportTemplate.findFirst({ where: { type, scaleId: null }, select: { content: true } })
  return wildcard ? Buffer.from(wildcard.content) : null
}

export function listReportTemplates(tx: Tx) {
  return tx.reportTemplate.findMany({
    orderBy: [{ type: 'asc' }, { scaleId: 'asc' }],
    include: { scale: { select: { id: true, name: true, dimension: true } } },
  })
}

export async function loadReportTemplate(tx: Tx, id: string) {
  const row = await tx.reportTemplate.findUnique({ where: { id } })
  if (!row) throw new DomainError(AuditErrors.REPORT_TEMPLATE_NOT_FOUND, { id })
  return row
}
