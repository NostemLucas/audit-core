/** Código legible de una auditoría: `AUD-2026-00042`. El número sale de la secuencia `audit_code_seq` (sin carreras). */
export function formatAuditCode(year: number, sequence: number): string {
  return `AUD-${year}-${String(sequence).padStart(5, '0')}`
}
