import { describe, expect, it } from 'vitest'
import {
  evaluationIdFromEvidencePath,
  evidenceFolder,
  evidenceRootFolder,
  reportPath,
  reportsRootFolder,
} from './storage-paths.js'

describe('storage-paths', () => {
  it('la carpeta de evidencia se deriva del código de la auditoría y el id del criterio, nunca de nombres', () => {
    expect(evidenceFolder('AUD-2026-00042', 'eval-1')).toBe('/Auditorias/AUD-2026-00042/Evidencias/eval-1')
  })

  it('las carpetas raíz (para compartir con el equipo) son las mismas, sin el segmento del id', () => {
    expect(evidenceRootFolder('AUD-2026-00042')).toBe('/Auditorias/AUD-2026-00042/Evidencias')
    expect(reportsRootFolder('AUD-2026-00042')).toBe('/Auditorias/AUD-2026-00042/Informes')
  })

  it('la ruta de un informe usa su propio id y la extensión pedida (por defecto docx)', () => {
    expect(reportPath('AUD-2026-00042', 'rep-1')).toBe('/Auditorias/AUD-2026-00042/Informes/rep-1.docx')
    expect(reportPath('AUD-2026-00042', 'rep-1', 'pdf')).toBe('/Auditorias/AUD-2026-00042/Informes/rep-1.pdf')
  })

  it('el evaluationId sale del segmento siguiente a "Evidencias"', () => {
    expect(evaluationIdFromEvidencePath('/Auditorias/AUD-2026-00042/Evidencias/eval-1/acta.pdf')).toBe('eval-1')
    expect(evaluationIdFromEvidencePath('/Auditorias/AUD-2026-00042/Evidencias/eval-1/')).toBe('eval-1')
  })

  it('una ruta sin "Evidencias", o donde no le sigue nada, no tiene evaluationId', () => {
    expect(evaluationIdFromEvidencePath('/Auditorias/AUD-2026-00042/Informes/rep-1.docx')).toBeNull()
    expect(evaluationIdFromEvidencePath('/Auditorias/AUD-2026-00042/Evidencias')).toBeNull()
    expect(evaluationIdFromEvidencePath('/Auditorias/AUD-2026-00042/Evidencias/')).toBeNull()
  })
})
