import PizZip from 'pizzip'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { startedAudit, type StartedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db, storage } = t

const generate = async (
  ctx: StartedAudit,
  body: Record<string, unknown> = {},
  role: TestRole = 'manager',
  who?: string,
) =>
  api()
    .post(`${A}/${ctx.auditId}/reports`)
    .set('authorization', await as(role, who))
    .send(body)

const list = async (ctx: StartedAudit, role: TestRole = 'manager', who?: string) =>
  api()
    .get(`${A}/${ctx.auditId}/reports`)
    .set('authorization', await as(role, who))

const get = async (ctx: StartedAudit, reportId: string, role: TestRole = 'manager', who?: string) =>
  api()
    .get(`${A}/${ctx.auditId}/reports/${reportId}`)
    .set('authorization', await as(role, who))

const documentXmlOf = (buffer: Buffer): string => new PizZip(buffer).file('word/document.xml')!.asText()

/**
 * Todo APROBADO y la auditoría CERRADA, directo en la BD (aquí se prueba el informe, no el flujo de cierre): conserva
 * lo que la API ya haya puesto (nivel alcanzado, no aplica) y completa el resto igualando el nivel alcanzado al
 * esperado (cumple exacto, sin brecha nueva) para no alterar qué criterios cuentan como brecha en el test.
 */
const closeAudit = async (ctx: StartedAudit) => {
  const evaluations = await db.evaluation.findMany({ where: { auditId: ctx.auditId } })
  for (const e of evaluations) {
    await db.evaluation.update({
      where: { id: e.id },
      data: {
        status: 'APPROVED',
        ...(e.achievedLevelId || e.isNotApplicable ? {} : { achievedLevelId: e.expectedLevelId }),
      },
    })
  }
  await db.audit.update({ where: { id: ctx.auditId }, data: { status: 'CLOSED', closedAt: new Date() } })
}

describe('generar un informe (POST /audits/:id/reports)', () => {
  it('el manager genera uno con el título de la auditoría por defecto; sube el .docx a Nextcloud y crea el registro', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    const res = await generate(ctx)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ type: 'COMPLIANCE', title: 'Auditoría ISO 27001' })
    expect(res.body.data.id).toBeTypeOf('string')
    expect(res.body.data.createdAt).toBeTypeOf('string')

    const code = (await db.audit.findUniqueOrThrow({ where: { id: ctx.auditId } })).code
    const uploaded = storage.uploaded.find((u) => u.path.includes(res.body.data.id))
    expect(uploaded?.path).toBe(`/Auditorias/${code}/Informes/${res.body.data.id}.docx`)
    expect(uploaded?.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(uploaded!.content.length).toBeGreaterThan(0)

    const row = await db.report.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(row.storageFileId).toMatch(/^fake-/)
  })

  it('el contenido del .docx refleja el estado REAL de la auditoría: los mismos números que /results y /gaps', async () => {
    const ctx = await startedAudit(t)
    const roles = await db.evaluation.findFirstOrThrow({ where: { auditId: ctx.auditId, control: { title: 'Roles' } } })
    const politicas = await db.evaluation.findFirstOrThrow({
      where: { auditId: ctx.auditId, control: { title: 'Políticas' } },
    })
    const parcial = ctx.lib.scale.levels.find((l) => l.label === 'Parcial')!
    const cumple = ctx.lib.scale.levels.find((l) => l.label === 'Cumple')!
    const ana = await as('auditor', 'ana')
    await api()
      .patch(`${A}/${ctx.auditId}/evaluations/${roles.id}`)
      .set('authorization', ana)
      .send({ achievedLevelId: parcial.id, findings: 'Cubre solo la mitad', severity: 'MINOR', version: roles.version })
    await api()
      .patch(`${A}/${ctx.auditId}/evaluations/${politicas.id}`)
      .set('authorization', ana)
      .send({ achievedLevelId: cumple.id, version: politicas.version })
    await closeAudit(ctx)

    const [resultsRes, gapsRes, reportRes] = await Promise.all([
      api()
        .get(`${A}/${ctx.auditId}/results`)
        .set('authorization', await as('manager')),
      api()
        .get(`${A}/${ctx.auditId}/gaps`)
        .set('authorization', await as('manager')),
      generate(ctx),
    ])
    expect(reportRes.status).toBe(201)
    const uploaded = storage.uploaded.find((u) => u.path.includes(reportRes.body.data.id))!
    const xml = documentXmlOf(uploaded.content)

    const overall = resultsRes.body.data.overall
    expect(xml).toContain(`Evaluados: ${overall.evaluated}`)
    expect(xml).toContain(`Cumplen: ${overall.meets}`)
    expect(xml).toContain(`Por debajo: ${overall.below}`)
    expect(xml).toContain('Gravedad de las brechas: 0 mayor(es) · 1 menor(es) · 0 observación(es)')

    const [gap] = gapsRes.body.data
    expect(gap.control.title).toBe('Roles')
    expect(gap.severity).toBe('MINOR')
    expect(xml).toContain('Roles')
    expect(xml).toContain('Cubre solo la mitad')
    expect(xml).toContain(gap.expectedLevel.label)
    expect(xml).toContain(gap.achievedLevel.label)

    // catálogo de controles: TODA la estructura, incluidos agrupadores (p. ej. "Selección", que no es evaluable)
    expect(xml).toContain('Organizacionales / A.5.1 Políticas — nivel 1 (evaluable)')
    expect(xml).toContain('Personas / — Selección — nivel 1 (agrupador)')

    // todos los resultados: Roles (por debajo) Y Políticas (cumple), no solo lo que falló como en "gaps"
    expect(xml).toContain('Organizacionales / A.5.2 Roles: esperado Cumple, alcanzado Parcial (no cumple)')
    expect(xml).toContain('Organizacionales / A.5.1 Políticas: esperado Cumple, alcanzado Cumple (cumple)')
  })

  it('el gráfico embebido es un PNG real, del tamaño que declara la plantilla y con color (no el marcador en blanco)', async () => {
    const ctx = await startedAudit(t)
    const roles = await db.evaluation.findFirstOrThrow({ where: { auditId: ctx.auditId, control: { title: 'Roles' } } })
    const parcial = ctx.lib.scale.levels.find((l) => l.label === 'Parcial')!
    await api()
      .patch(`${A}/${ctx.auditId}/evaluations/${roles.id}`)
      .set('authorization', await as('auditor', 'ana'))
      .send({ achievedLevelId: parcial.id, findings: 'x', severity: 'MINOR', version: roles.version })
    await closeAudit(ctx)

    const res = await generate(ctx)
    expect(res.status).toBe(201)
    const uploaded = storage.uploaded.find((u) => u.path.includes(res.body.data.id))!
    const zip = new PizZip(uploaded.content)
    const chartBytes = zip.file('word/media/chart1.png')!.asUint8Array()

    const meta = await sharp(chartBytes).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(720)
    expect(meta.height).toBe(380)

    // Roles quedó por debajo: su barra "alcanzado" debe ser roja (#dc2626). No basta con "algún píxel no blanco"
    // (el texto también lo es): busca el color exacto de la barra, en cantidad, para distinguirlo del marcador o de
    // un gráfico vacío (que solo tendría el texto "Sin dominios evaluados" en negro).
    const { data, info } = await sharp(chartBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let redPixels = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] === 0xdc && data[i + 1] === 0x26 && data[i + 2] === 0x26) redPixels += 1
    }
    expect(redPixels).toBeGreaterThan(100)
  })

  it('el líder también genera; un auditor sin ser líder, otro GERENTE y el ADMIN no: 403', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    expect((await generate(ctx, {}, 'auditor', 'lider')).status).toBe(201)
    expect((await generate(ctx, {}, 'auditor', 'ana')).status).toBe(403)
    expect((await generate(ctx, {}, 'manager', 'otro')).status).toBe(403)
    expect((await generate(ctx, {}, 'admin')).status).toBe(403)
  })

  it('el tipo y el título se pueden indicar; se registra en el historial de la auditoría', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    const res = await generate(ctx, { type: 'GAP_ANALYSIS', title: 'Informe de brechas — cierre Q3' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ type: 'GAP_ANALYSIS', title: 'Informe de brechas — cierre Q3' })

    const event = await db.auditEvent.findFirstOrThrow({ where: { auditId: ctx.auditId, type: 'ReportGenerated' } })
    expect(event.payload).toMatchObject({ reportId: res.body.data.id, title: 'Informe de brechas — cierre Q3' })
    expect(renderEventMessage(event.type, event.payload)).toBe('Generó el informe "Informe de brechas — cierre Q3"')
  })

  it('solo con la auditoría CERRADA o ARCHIVADA: en cualquier otro estado, 409 AUDIT_NOT_REPORTABLE', async () => {
    const ctx = await startedAudit(t)
    for (const status of ['DRAFT', 'IN_PROGRESS'] as const) {
      await db.audit.update({ where: { id: ctx.auditId }, data: { status } })
      const res = await generate(ctx)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('AUDIT_NOT_REPORTABLE')
    }
    await closeAudit(ctx) // deja CLOSED
    expect((await generate(ctx)).status).toBe(201)
    await db.audit.update({ where: { id: ctx.auditId }, data: { status: 'ARCHIVED' } })
    expect((await generate(ctx)).status).toBe(201)
  })

  it('una auditoría inexistente es 404; un título vacío o demasiado largo, 400', async () => {
    const fake = { auditId: UNKNOWN_ID } as StartedAudit
    expect((await generate(fake)).status).toBe(404)
    const ctx = await startedAudit(t)
    expect((await generate(ctx, { title: '' })).status).toBe(400)
    expect((await generate(ctx, { title: 'x'.repeat(1000) })).status).toBe(400)
  })
})

describe('listar y ver un informe', () => {
  it('lo ven todos los que ven la auditoría, lo más reciente primero; un auditor ajeno recibe 403', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    const first = await generate(ctx, { title: 'Primero' })
    const second = await generate(ctx, { title: 'Segundo' })
    for (const [role, who] of [
      ['auditor', 'ana'],
      ['auditor', 'lider'],
      ['manager', 'manager'],
      ['admin', 'admin'],
    ] as const) {
      const res = await list(ctx, role, who)
      expect(res.status, `${role}/${who}`).toBe(200)
      expect(res.body.data.map((r: { title: string }) => r.title)).toEqual(['Segundo', 'Primero'])
    }
    expect((await list(ctx, 'auditor', 'ajeno')).status).toBe(403)
    void first
    void second
  })

  it('GET de uno trae la URL de descarga (un share de solo lectura pedido al vuelo)', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    const created = await generate(ctx)
    const res = await get(ctx, created.body.data.id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: created.body.data.id, title: 'Auditoría ISO 27001' })
    expect(res.body.data.downloadUrl).toMatch(/^https:\/\/nextcloud\.test\/s\/read-/)
    const code = (await db.audit.findUniqueOrThrow({ where: { id: ctx.auditId } })).code
    expect(storage.readShares).toContain(`/Auditorias/${code}/Informes/${created.body.data.id}.docx`)
  })

  it('cada GET pide un share nuevo (no se guarda, se puede revocar y renovar sin tocar el informe)', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    const created = await generate(ctx)
    await get(ctx, created.body.data.id)
    await get(ctx, created.body.data.id)
    expect(storage.readShares.filter((p) => p.includes(created.body.data.id))).toHaveLength(2)
  })

  it('un auditor ajeno a la auditoría no puede pedir un informe puntual: 403', async () => {
    const ctx = await startedAudit(t)
    await closeAudit(ctx)
    const created = await generate(ctx)
    expect((await get(ctx, created.body.data.id, 'auditor', 'ajeno')).status).toBe(403)
    expect(storage.readShares).toHaveLength(0) // ni siquiera llegó a pedirse el share
  })

  it('un informe inexistente, o de otra auditoría, es 404', async () => {
    const one = await startedAudit(t)
    await closeAudit(one)
    const two = await startedAudit(t, 'CONFORMITY', '-2')
    const created = await generate(one)
    expect((await get(one, UNKNOWN_ID)).status).toBe(404)
    expect((await get(two, created.body.data.id)).status).toBe(404)
  })
})
