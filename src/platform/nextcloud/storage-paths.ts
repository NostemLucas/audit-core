/**
 * Rutas de Nextcloud, siempre derivadas de IDS ESTABLES (nunca de nombres, que cambian) — docs/07 §1.1. Función pura:
 * ninguna se guarda, se recalculan cada vez que se necesitan.
 */
export const evidenceFolder = (auditCode: string, evaluationId: string): string =>
  `/Auditorias/${auditCode}/Evidencias/${evaluationId}`

export const reportPath = (auditCode: string, reportId: string, extension = 'docx'): string =>
  `/Auditorias/${auditCode}/Informes/${reportId}.${extension}`

/** El `evaluationId` de una ruta de evidencia (penúltimo segmento): de ahí sale el criterio en el webhook (docs/07 §1.2). */
export function evaluationIdFromEvidencePath(path: string): string | null {
  const segments = path.split('/').filter(Boolean)
  const marker = segments.indexOf('Evidencias')
  return marker !== -1 && segments.length > marker + 1 ? segments[marker + 1]! : null
}
