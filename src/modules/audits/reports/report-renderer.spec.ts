import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import { loadDefaultTemplate } from './report.template.js'
import { renderReport, type ReportData } from './report-renderer.js'

const DATA: ReportData = {
  auditCode: 'AUD-2026-00001',
  auditName: 'Auditoría ISO 27001',
  organizationName: 'ACME',
  generatedAt: '2026-09-22',
  evaluated: 4,
  meets: 2,
  below: 1,
  notApplicable: 1,
  pending: 0,
  domains: [{ title: 'Organizacionales', averageExpected: 100, averageAchieved: 75, gap: -25 }],
  gaps: [
    {
      domain: 'Organizacionales',
      reference: 'A.5.2',
      title: 'Roles',
      expectedLabel: 'Cumple',
      achievedLabel: 'Parcial',
      findings: 'Cubre la mitad',
    },
  ],
}

/** Ningún marcador (`{...}`) sobrevive, y `docxtemplater` nunca escribió su "undefined" por defecto (docs/07 §2). */
function assertFullySubstituted(xml: string) {
  expect(xml).not.toMatch(/\{[a-zA-Z]/)
  expect(xml).not.toContain('undefined')
}

describe('renderReport', () => {
  it('sustituye cada marcador escalar con su valor EXACTO (no solo "no rompe")', async () => {
    const buffer = renderReport(loadDefaultTemplate(), DATA)
    const { default: PizZip } = await import('pizzip')
    const xml = new PizZip(buffer).file('word/document.xml')!.asText()
    assertFullySubstituted(xml)
    expect(xml).toContain('AUD-2026-00001 — Auditoría ISO 27001')
    expect(xml).toContain('Organización: ACME')
    expect(xml).toContain('Generado: 2026-09-22')
    expect(xml).toContain('Evaluados: 4 · Cumplen: 2 · Por debajo: 1 · No aplica: 1 · Pendientes: 0')
  })

  it('el bucle de dominios repite una fila por dominio, con sus propios valores', async () => {
    const buffer = renderReport(loadDefaultTemplate(), {
      ...DATA,
      domains: [
        { title: 'Organizacionales', averageExpected: 100, averageAchieved: 75, gap: -25 },
        { title: 'Personas', averageExpected: 50, averageAchieved: 50, gap: 0 },
      ],
    })
    const { default: PizZip } = await import('pizzip')
    const xml = new PizZip(buffer).file('word/document.xml')!.asText()
    assertFullySubstituted(xml)
    expect(xml).toContain('Organizacionales: esperado 100, alcanzado 75, brecha -25')
    expect(xml).toContain('Personas: esperado 50, alcanzado 50, brecha 0')
  })

  it('el bucle de brechas repite una fila por criterio, con la referencia y el hallazgo', async () => {
    const buffer = renderReport(loadDefaultTemplate(), {
      ...DATA,
      gaps: [
        ...DATA.gaps,
        {
          domain: 'Personas',
          reference: null,
          title: 'Antecedentes',
          expectedLabel: 'Cumple',
          achievedLabel: 'No cumple',
          findings: 'No existe',
        },
      ],
    })
    const { default: PizZip } = await import('pizzip')
    const xml = new PizZip(buffer).file('word/document.xml')!.asText()
    assertFullySubstituted(xml) // ni siquiera con `reference: null` (se rellena con "—", no "undefined")
    expect(xml).toContain('Organizacionales / A.5.2 Roles: esperado Cumple, alcanzado Parcial. Cubre la mitad')
    expect(xml).toContain('Personas / — Antecedentes: esperado Cumple, alcanzado No cumple. No existe')
  })

  it('sin dominios ni brechas, los bucles quedan vacíos: nada de "undefined" ni de marcadores sueltos', async () => {
    const buffer = renderReport(loadDefaultTemplate(), { ...DATA, domains: [], gaps: [] })
    const { default: PizZip } = await import('pizzip')
    const xml = new PizZip(buffer).file('word/document.xml')!.asText()
    assertFullySubstituted(xml)
    expect(xml).not.toContain('Roles')
  })

  it('un `null` en un promedio (dominio sin nada evaluado) sale como "—", nunca "undefined" ni vacío ambiguo', async () => {
    const buffer = renderReport(loadDefaultTemplate(), {
      ...DATA,
      domains: [{ title: 'Personas', averageExpected: null, averageAchieved: null, gap: null }],
    })
    const { default: PizZip } = await import('pizzip')
    const xml = new PizZip(buffer).file('word/document.xml')!.asText()
    assertFullySubstituted(xml)
    expect(xml).toContain('Personas: esperado —, alcanzado —, brecha —')
  })

  it('una plantilla que no es un zip válido: REPORT_GENERATION_FAILED, no la excepción cruda de la librería', () => {
    expect(() => renderReport(Buffer.from('no soy un docx'), DATA)).toThrow(
      expect.objectContaining({ code: 'REPORT_GENERATION_FAILED' }),
    )
  })

  it('una plantilla que es un zip pero sin word/document.xml: también REPORT_GENERATION_FAILED', async () => {
    const { default: PizZip } = await import('pizzip')
    const empty = new PizZip()
    empty.file('nada.txt', 'x')
    const buffer = empty.generate({ type: 'nodebuffer' })
    expect(() => renderReport(buffer, DATA)).toThrow(expect.objectContaining({ code: 'REPORT_GENERATION_FAILED' }))
  })
})

describe('loadDefaultTemplate', () => {
  it('lee un archivo real que existe (no vacío)', () => {
    expect(loadDefaultTemplate().length).toBeGreaterThan(0)
  })
})
