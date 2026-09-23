import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { DomainError } from '../../../platform/errors/index.js'
import { AuditErrors } from '../domain/errors.js'
import type { ReportData } from './report-renderer.js'

/**
 * Datos de prueba que ejercitan CADA marcador y bucle del catálogo (docs/07 §2), para detectar al SUBIR la plantilla
 * lo que en la fase 4c solo se encontró al inspeccionar un informe real: un marcador con un error de tipeo no lanza
 * ninguna excepción, `docxtemplater` solo pide su valor a `nullGetter` — que en `report-renderer.ts` escribe "—"
 * (para que un promedio sin datos no salga como el texto "undefined"). Ningún campo de aquí abajo es legítimamente
 * `null`, así que CUALQUIER llamada a `nullGetter` durante este render es, por descarte, un marcador mal escrito.
 */
const DUMMY_DATA: ReportData = {
  auditCode: 'AUD-0000-00000',
  auditName: 'Auditoría de prueba',
  organizationName: 'Organización de prueba',
  generatedAt: '2026-01-01',
  evaluated: 1,
  meets: 1,
  below: 1,
  notApplicable: 1,
  pending: 1,
  majorCount: 1,
  minorCount: 1,
  observationCount: 1,
  domains: [{ title: 'Dominio de prueba', averageExpected: 1, averageAchieved: 1, gap: 1 }],
  gaps: [
    {
      domain: 'Dominio de prueba',
      reference: 'X.1',
      title: 'Criterio de prueba',
      expectedLabel: 'Nivel',
      achievedLabel: 'Nivel',
      findings: 'Hallazgo de prueba',
      severity: 'Gravedad de prueba',
    },
  ],
  controls: [{ domain: 'Dominio de prueba', reference: 'X.1', title: 'Criterio de prueba', depth: 1, isLeaf: true }],
  results: [
    {
      domain: 'Dominio de prueba',
      reference: 'X.1',
      title: 'Criterio de prueba',
      expectedLabel: 'Nivel',
      achievedLabel: 'Nivel',
      meetsExpected: true,
      severity: 'Gravedad de prueba',
      findings: 'Hallazgo de prueba',
    },
  ],
}

export interface ReportTemplateWarning {
  readonly message: string
}

/**
 * Valida una plantilla subida ANTES de guardarla: la renderiza con `DUMMY_DATA` (un render PROPIO, no `renderReport`
 * — necesita su propio `nullGetter` para poder señalar el nombre exacto del marcador, no solo detectar que algo
 * falló). Lanza `REPORT_TEMPLATE_INVALID` si no sirve; si sirve pero le falta el marcador de imagen del gráfico, lo
 * avisa sin bloquear (una plantilla sin gráfico es válida, solo no lo mostrará).
 */
export function validateReportTemplate(content: Buffer): readonly ReportTemplateWarning[] {
  let zip: PizZip
  try {
    zip = new PizZip(content)
  } catch (cause) {
    throw new DomainError(AuditErrors.REPORT_TEMPLATE_INVALID, { reason: 'no es un .docx válido' }, { cause })
  }
  if (!zip.file('word/document.xml')) {
    throw new DomainError(AuditErrors.REPORT_TEMPLATE_INVALID, { reason: 'no tiene word/document.xml' })
  }

  const unresolved: string[] = []
  try {
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: (part: { value?: string }) => {
        if (part.value) unresolved.push(part.value)
        return '—'
      },
    })
    doc.render(DUMMY_DATA as unknown as Record<string, unknown>)
  } catch (cause) {
    throw new DomainError(
      AuditErrors.REPORT_TEMPLATE_INVALID,
      { reason: 'no se pudo rellenar con datos de prueba' },
      { cause },
    )
  }
  if (unresolved.length > 0) {
    throw new DomainError(AuditErrors.REPORT_TEMPLATE_INVALID, {
      reason: 'hay marcadores que no corresponden a ningún campo',
      markers: [...new Set(unresolved)],
    })
  }

  const warnings: ReportTemplateWarning[] = []
  if (!zip.file('word/media/chart1.png')) {
    warnings.push({
      message: 'La plantilla no tiene el marcador de imagen del gráfico: no mostrará el gráfico por dominio',
    })
  }
  return warnings
}
