import { describe, expect, it } from 'vitest'
import { type TestRole, useTestApi } from './support/api.js'
import { startedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'

const t = useTestApi()
const { api, as, db, storage } = t

const list = async (auditId: string, query = '', role: TestRole = 'manager') =>
  api()
    .get(`${A}/${auditId}/files${query}`)
    .set('authorization', await as(role))

describe('listar carpetas de la auditoría (GET /audits/:id/files)', () => {
  it('navega Evidencias: lista la raíz de la sección y devuelve rutas relativas a ella', async () => {
    const ctx = await startedAudit(t)
    const { code } = await db.audit.findUniqueOrThrow({ where: { id: ctx.auditId }, select: { code: true } })
    storage.seedFolder(`/Auditorias/${code}/Evidencias`, [
      {
        name: 'eval-1',
        path: `/Auditorias/${code}/Evidencias/eval-1`,
        isFolder: true,
        size: null,
        mimeType: null,
        modifiedAt: null,
      },
      {
        name: 'nota.pdf',
        path: `/Auditorias/${code}/Evidencias/nota.pdf`,
        isFolder: false,
        size: 2048,
        mimeType: 'application/pdf',
        modifiedAt: new Date('2026-03-05T10:00:00.000Z'),
      },
    ])

    const res = await list(ctx.auditId, '?section=EVIDENCIA')
    expect(res.status).toBe(200)
    expect(res.body.data.section).toBe('EVIDENCIA')
    expect(res.body.data.path).toBe('')
    expect(res.body.data.entries).toEqual([
      expect.objectContaining({ name: 'eval-1', path: 'eval-1', isFolder: true, size: null }),
      expect.objectContaining({ name: 'nota.pdf', path: 'nota.pdf', isFolder: false, size: 2048 }),
    ])
  })

  it('una carpeta que todavía no existe en Nextcloud se muestra vacía, no como error', async () => {
    const ctx = await startedAudit(t)
    const res = await list(ctx.auditId, '?section=INFORMES')
    expect(res.status).toBe(200)
    expect(res.body.data.entries).toEqual([])
  })

  it('no deja salir de la carpeta de la auditoría: rechaza `..` y rutas con barra invertida', async () => {
    const ctx = await startedAudit(t)
    expect((await list(ctx.auditId, '?section=EVIDENCIA&path=../AUD-OTRA')).status).toBe(400)
    expect((await list(ctx.auditId, '?section=INFORMES&path=..%5Cfoo')).status).toBe(400)
  })

  it('un auditor que no es miembro del equipo no ve los archivos de la auditoría', async () => {
    const ctx = await startedAudit(t)
    expect((await list(ctx.auditId, '?section=EVIDENCIA', 'auditor')).status).toBe(403)
  })
})
