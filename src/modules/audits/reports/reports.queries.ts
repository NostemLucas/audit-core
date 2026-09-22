import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { AuditErrors } from '../domain/errors.js'

export function listReports(tx: Tx, auditId: string) {
  return tx.report.findMany({ where: { auditId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
}

export async function loadReport(tx: Tx, auditId: string, reportId: string) {
  const row = await tx.report.findFirst({ where: { id: reportId, auditId } })
  if (!row) throw new DomainError(AuditErrors.REPORT_NOT_FOUND, { auditId, reportId })
  return row
}
