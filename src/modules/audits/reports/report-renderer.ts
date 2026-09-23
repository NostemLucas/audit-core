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
  /** TODOS los nodos de la plantilla (dominios, agrupadores y hojas): solo estructura, sin datos de evaluación. Para
   *  una plantilla que necesite mostrar la jerarquía completa (docs/07 §2). */
  readonly controls: ReadonlyArray<{
    readonly domain: string
    readonly reference: string | null
    readonly title: string
    readonly depth: number
    readonly isLeaf: boolean
  }>
  /** TODAS las hojas evaluadas (no solo las que quedaron por debajo, a diferencia de `gaps`): un catálogo de
   *  resultados completo (docs/07 §2). */
  readonly results: ReadonlyArray<{
    readonly domain: string
    readonly reference: string | null
    readonly title: string
    readonly expectedLabel: string | null
    readonly achievedLabel: string | null
    readonly meetsExpected: boolean
    readonly severity: string | null
    readonly findings: string | null
  }>
}

/**
 * Rellena la plantilla con los datos (`docxtemplater` + `pizzip`, misma técnica que el proyecto anterior). Función
 * pura sobre bytes: no sabe de BD ni de Nextcloud. Un valor `null` sale como "—" (`nullGetter`): por defecto
 * `docxtemplater` escribiría el texto "undefined", que en un informe real se leería como un error de la plantilla.
 * Cualquier fallo (plantilla corrupta, marcador que no encuentra su dato) se traduce a `REPORT_GENERATION_FAILED`;
 * nunca se sube ni se guarda un informe a medias.
 *
 * `chartPng`, si se da, REEMPLAZA los bytes del `word/media/chart1.png` de la plantilla (el marcador de imagen —
 * posición, tamaño, relación — ya está fijo en la plantilla estática; solo cambia el contenido del PNG por auditoría).
 * Así se evita cualquier módulo de imágenes de `docxtemplater` (de pago): el "marcador" de la imagen es, en los
 * hechos, un nombre de archivo fijo dentro del zip.
 */
export function renderReport(template: Buffer, data: ReportData, chartPng: Buffer | null = null): Buffer {
  try {
    const zip = new PizZip(template)
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '—' })
    doc.render(data as unknown as Record<string, unknown>)
    const rendered = doc.getZip()
    if (chartPng) rendered.file('word/media/chart1.png', chartPng)
    return rendered.generate({ type: 'nodebuffer' })
  } catch (cause) {
    throw new DomainError(AuditErrors.REPORT_GENERATION_FAILED, {}, { cause })
  }
}
