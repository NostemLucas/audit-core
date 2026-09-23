import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import { loadDefaultTemplate } from './report.template.js'
import { validateReportTemplate } from './report-template-validation.js'

describe('validateReportTemplate', () => {
  it('la plantilla de fábrica es válida y no trae avisos (ya tiene el marcador del gráfico)', () => {
    expect(validateReportTemplate(loadDefaultTemplate())).toEqual([])
  })

  it('un archivo que no es un .docx: REPORT_TEMPLATE_INVALID', () => {
    expect(() => validateReportTemplate(Buffer.from('esto no es un docx'))).toThrow(
      expect.objectContaining({ code: 'REPORT_TEMPLATE_INVALID' }),
    )
  })

  it('un .docx sin word/document.xml: REPORT_TEMPLATE_INVALID', async () => {
    const { default: PizZip } = await import('pizzip')
    const empty = new PizZip()
    empty.file('nada.txt', 'x')
    expect(() => validateReportTemplate(empty.generate({ type: 'nodebuffer' }))).toThrow(
      expect.objectContaining({ code: 'REPORT_TEMPLATE_INVALID' }),
    )
  })

  it('un marcador con el nombre mal escrito: REPORT_TEMPLATE_INVALID (no lo deja pasar como "undefined")', async () => {
    const { default: PizZip } = await import('pizzip')
    const zip = new PizZip(loadDefaultTemplate())
    const xml = zip.file('word/document.xml')!.asText()
    // {auditCode} -> {auditCodeX}: un typo real, exactamente el bug de la fase 4c.
    zip.file('word/document.xml', xml.replace('{auditCode}', '{auditCodeX}'))
    expect(() => validateReportTemplate(zip.generate({ type: 'nodebuffer' }))).toThrow(
      expect.objectContaining({
        code: 'REPORT_TEMPLATE_INVALID',
        details: expect.objectContaining({ markers: ['auditCodeX'] }),
      }),
    )
  })

  it('sin el marcador de imagen del gráfico: sigue siendo válida, pero con un aviso (no bloquea)', async () => {
    const { default: PizZip } = await import('pizzip')
    const zip = new PizZip(loadDefaultTemplate())
    zip.remove('word/media/chart1.png')
    const warnings = validateReportTemplate(zip.generate({ type: 'nodebuffer' }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/gráfico/)
  })
})
