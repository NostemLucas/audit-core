/**
 * Rutas de Nextcloud, siempre derivadas de IDS ESTABLES (nunca de nombres, que cambian) — docs/07 §1.1. Función pura:
 * ninguna se guarda, se recalculan cada vez que se necesitan.
 */
export const evidenceFolder = (auditCode: string, evaluationId: string): string =>
  `/Auditorias/${auditCode}/Evidencias/${evaluationId}`

export const reportPath = (auditCode: string, reportId: string, extension = 'docx'): string =>
  `/Auditorias/${auditCode}/Informes/${reportId}.${extension}`

/** La carpeta con TODA la evidencia de la auditoría (todas las evaluationId): se comparte con el equipo, de solo
 * lectura, mientras sean miembros (docs/07 §1.5) — distinta del share de subida de 1.1, que es de un solo criterio. */
export const evidenceRootFolder = (auditCode: string): string => `/Auditorias/${auditCode}/Evidencias`

/** La carpeta con TODOS los informes de la auditoría: se comparte con el equipo, editable, mientras sean miembros
 * (docs/07 §1.5) — para que la puedan abrir y trabajar en Nextcloud/OnlyOffice sin pasar por esta API. */
export const reportsRootFolder = (auditCode: string): string => `/Auditorias/${auditCode}/Informes`

/** El `evaluationId` de una ruta de evidencia (penúltimo segmento): de ahí sale el criterio en el webhook (docs/07 §1.2). */
export function evaluationIdFromEvidencePath(path: string): string | null {
  const segments = path.split('/').filter(Boolean)
  const marker = segments.indexOf('Evidencias')
  return marker !== -1 && segments.length > marker + 1 ? segments[marker + 1]! : null
}
