import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { DomainError } from '../../../platform/errors/index.js'
import { AuditErrors } from '../domain/errors.js'

/**
 * Lo que la plantilla por defecto espera (docs/07 §2, los marcadores de `compliance-report.docx`). TODO plano, sin
 * objetos anidados: `docxtemplater` (sin módulos de pago) resuelve un marcador buscando esa clave EXACTA en el
 * objeto — `{overall.evaluated}` no "entra" a `overall`, busca literalmente la clave `"overall.evaluated"` y no la
 * encuentra (se comprobó rindiendo la plantilla: sale "undefined", no un error). Aplanar aquí es más simple y más
 * seguro que depender de su sintaxis de alcance (`{#tag}`) para valores que además pueden ser `null`.
 */
export interface ReportData {
  readonly auditCode: string
  readonly auditName: string
  readonly organizationName: string
  readonly generatedAt: string
  readonly evaluated: number
  readonly meets: number
  readonly below: number
  readonly notApplicable: number
  readonly pending: number
  /** Conteo de brechas por gravedad (docs/06 §3, docs/07 §2): las sin clasificar no están en ninguno de los tres. */
  readonly majorCount: number
  readonly minorCount: number
  readonly observationCount: number
  readonly domains: ReadonlyArray<{
    readonly title: string
    readonly averageExpected: number | null
    readonly averageAchieved: number | null
    readonly gap: number | null
  }>
  readonly gaps: ReadonlyArray<{
    readonly domain: string
    readonly reference: string | null
    readonly title: string
    readonly expectedLabel: string | null
    readonly achievedLabel: string | null
    readonly findings: string | null
    /** Ya traducida (docs/06 §3): `null` cuando no se clasificó (siempre el caso en capacidad, opcional en conformidad). */
    readonly severity: string | null
  }>
}

/**
 * Rellena la plantilla con los datos (`docxtemplater` + `pizzip`, misma técnica que el proyecto anterior). Función
 * pura sobre bytes: no sabe de BD ni de Nextcloud. Un valor `null` sale como "—" (`nullGetter`): por defecto
 * `docxtemplater` escribiría el texto "undefined", que en un informe real se leería como un error de la plantilla.
 * Cualquier fallo (plantilla corrupta, marcador que no encuentra su dato) se traduce a `REPORT_GENERATION_FAILED`;
 * nunca se sube ni se guarda un informe a medias.
 */
export function renderReport(template: Buffer, data: ReportData): Buffer {
  try {
    const zip = new PizZip(template)
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '—' })
    doc.render(data as unknown as Record<string, unknown>)
    return doc.getZip().generate({ type: 'nodebuffer' })
  } catch (cause) {
    throw new DomainError(AuditErrors.REPORT_GENERATION_FAILED, {}, { cause })
  }
}
