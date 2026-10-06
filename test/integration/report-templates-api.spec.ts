import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { loadDefaultTemplate } from '../../src/modules/audits/reports/report.template.js'
import { type TestRole, useTestApi } from './support/api.js'
import { startedAudit } from './support/started-audit.js'

const T = '/api/v1/report-templates'
const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const t = useTestApi()
const { api, as, db } = t

/** La plantilla de fábrica, con un texto de sobra (fuera de cualquier marcador) para distinguirla al generar. */
function markedTemplate(marker: string): Buffer {
  const zip = new PizZip(loadDefaultTemplate())
  const xml = zip.file('word/document.xml')!.asText()
  zip.file('word/document.xml', xml.replace('<w:sectPr/>', `<w:p><w:r><w:t>${marker}</w:t></w:r></w:p><w:sectPr/>`))
  return zip.generate({ type: 'nodebuffer' })
}

async function upload(
  file: Buffer | undefined,
  query: Record<string, string>,
  role: TestRole = 'manager',
  who?: string,
) {
  let req = api()
    .post(T)
    .query(query)
    .set('authorization', await as(role, who))
  if (file) req = req.attach('file', file, { filename: 'plantilla.docx', contentType: DOCX_MIME })
  return req
}
const list = async (role: TestRole = 'manager', who?: string) =>
  api()
    .get(T)
    .set('authorization', await as(role, who))
const get = async (id: string, role: TestRole = 'manager', who?: string) =>
  api()
    .get(`${T}/${id}`)
    .set('authorization', await as(role, who))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
const del = async (id: string, role: TestRole = 'manager', who?: string) =>
  api()
    .delete(`${T}/${id}`)
    .set('authorization', await as(role, who))

describe('subir una plantilla de informe', () => {
  it('el GERENTE sube una válida: 201 con la vista y sin avisos (ya trae el marcador del gráfico)', async () => {
    const res = await upload(markedTemplate('x'), { type: 'COMPLIANCE' })
    expect(res.status).toBe(201)
    expect(res.body.data.template).toMatchObject({ type: 'COMPLIANCE', scaleId: null, scale: null })
    expect(res.body.data.warnings).toEqual([])
    expect(await db.reportTemplate.count()).toBe(1)
  })

  it('con escala: se guarda esa, no el comodín, y la respuesta trae la escala', async () => {
    const scale = await db.scale.create({ data: { name: 'Escala propia', dimension: 'MATURITY' } })
    const res = await upload(markedTemplate('x'), { type: 'COMPLIANCE', scaleId: scale.id })
    expect(res.body.data.template).toMatchObject({
      type: 'COMPLIANCE',
      scaleId: scale.id,
      scale: { id: scale.id, name: 'Escala propia', dimension: 'MATURITY' },
    })
  })

  it('una escala que no existe: 404, no se guarda nada', async () => {
    const res = await upload(markedTemplate('x'), { type: 'COMPLIANCE', scaleId: UNKNOWN_ID })
    expect(res.status).toBe(404)
    expect(await db.reportTemplate.count()).toBe(0)
  })

  it('subir de nuevo para el mismo (tipo, escala) reemplaza, no duplica', async () => {
    const first = await upload(markedTemplate('uno'), { type: 'GAP_ANALYSIS' })
    const second = await upload(markedTemplate('dos'), { type: 'GAP_ANALYSIS' })
    expect(first.body.data.template.id).toBe(second.body.data.template.id)
    expect(await db.reportTemplate.count({ where: { type: 'GAP_ANALYSIS' } })).toBe(1)
  })

  it('un marcador que no corresponde a ningún campo: 422 REPORT_TEMPLATE_INVALID, no se guarda nada', async () => {
    const zip = new PizZip(loadDefaultTemplate())
    const xml = zip.file('word/document.xml')!.asText()
    zip.file('word/document.xml', xml.replace('{auditCode}', '{auditCodeX}'))
    const res = await upload(zip.generate({ type: 'nodebuffer' }), { type: 'COMPLIANCE' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('REPORT_TEMPLATE_INVALID')
    expect(await db.reportTemplate.count()).toBe(0)
  })

  it('sin el marcador de imagen del gráfico: se guarda igual, pero con un aviso', async () => {
    const zip = new PizZip(loadDefaultTemplate())
    zip.remove('word/media/chart1.png')
    const res = await upload(zip.generate({ type: 'nodebuffer' }), { type: 'FINDINGS' })
    expect(res.status).toBe(201)
    expect(res.body.data.warnings).toHaveLength(1)
    expect(res.body.data.warnings[0]).toMatch(/gráfico/)
  })

  it('sin archivo: 422; un AUDITOR no sube (403); sin token 401; un type inválido 400', async () => {
    expect((await upload(undefined, { type: 'COMPLIANCE' })).status).toBe(422)
    expect((await upload(markedTemplate('x'), { type: 'COMPLIANCE' }, 'auditor')).status).toBe(403)
    expect(
      (await api().post(T).query({ type: 'COMPLIANCE' }).attach('file', markedTemplate('x'), 'x.docx')).status,
    ).toBe(401)
    expect((await upload(markedTemplate('x'), { type: 'NO_EXISTE' })).status).toBe(400)
  })
})

describe('listar, descargar y borrar', () => {
  it('la lista trae tipo y escala de cada una; un AUDITOR no la administra ni la ve (403)', async () => {
    const scale = await db.scale.create({ data: { name: 'Conformidad propia', dimension: 'CONFORMITY' } })
    await upload(markedTemplate('a'), { type: 'COMPLIANCE' })
    await upload(markedTemplate('b'), { type: 'COMPLIANCE', scaleId: scale.id })
    const res = await list()
    expect(res.status).toBe(200)
    expect(
      res.body.data
        .map((tpl: { type: string; scale: { name: string } | null }) => [tpl.type, tpl.scale?.name ?? null])
        .sort(),
    ).toEqual([
      ['COMPLIANCE', null],
      ['COMPLIANCE', 'Conformidad propia'],
    ])
    expect((await list('auditor')).status).toBe(403)
  })

  it('descarga los bytes exactos que se subieron', async () => {
    const file = markedTemplate('contenido-original')
    const uploaded = await upload(file, { type: 'OTHER' })
    const res = await get(uploaded.body.data.template.id)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(DOCX_MIME)
    expect(Buffer.compare(res.body as Buffer, file)).toBe(0)
  })

  it('borrar vuelve a la de fábrica: un GET después es 404', async () => {
    const uploaded = await upload(markedTemplate('x'), { type: 'EXECUTIVE_SUMMARY' })
    const id = uploaded.body.data.template.id
    expect((await del(id)).status).toBe(204)
    expect((await get(id)).status).toBe(404)
    expect(await db.reportTemplate.count()).toBe(0)
  })

  it('descarga la plantilla de fábrica (los bytes del archivo por defecto); un AUDITOR no la ve (403)', async () => {
    const res = await api()
      .get(`${T}/factory`)
      .set('authorization', await as('manager'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(DOCX_MIME)
    expect(Buffer.compare(res.body as Buffer, loadDefaultTemplate())).toBe(0)
    expect(
      (
        await api()
          .get(`${T}/factory`)
          .set('authorization', await as('auditor'))
      ).status,
    ).toBe(403)
  })

  it('un id inexistente: 404 al descargar o borrar', async () => {
    expect((await get(UNKNOWN_ID)).status).toBe(404)
    expect((await del(UNKNOWN_ID)).status).toBe(404)
  })
})

describe('la plantilla personalizada se usa al generar (docs/07 §2)', () => {
  const generate = async (auditId: string, type: string) =>
    api()
      .post(`${A}/${auditId}/reports`)
      .set('authorization', await as('manager'))
      .send({ type })

  /** Generar un informe exige la auditoría cerrada; aquí no importa el resultado, solo cuál plantilla se usó. */
  const closeAudit = (auditId: string) => db.audit.update({ where: { id: auditId }, data: { status: 'CLOSED' } })

  const xmlOf = (buffer: Buffer): string => new PizZip(buffer).file('word/document.xml')!.asText()

  it('sin plantilla propia: usa la de fábrica (sin cambios de comportamiento)', async () => {
    const ctx = await startedAudit(t, 'CONFORMITY', '-sin-plantilla')
    await closeAudit(ctx.auditId)
    const res = await generate(ctx.auditId, 'COMPLIANCE')
    expect(res.status).toBe(201)
    const uploaded = t.storage.uploaded.find((u) => u.path.includes(res.body.data.id))!
    expect(xmlOf(uploaded.content)).not.toContain('marcador-personalizado')
  })

  it('con un comodín (sin escala): se usa para cualquier escala de ese tipo', async () => {
    await upload(markedTemplate('marcador-comodin'), { type: 'COMPLIANCE' })
    const ctx = await startedAudit(t, 'MATURITY', '-comodin')
    await closeAudit(ctx.auditId)
    const res = await generate(ctx.auditId, 'COMPLIANCE')
    const uploaded = t.storage.uploaded.find((u) => u.path.includes(res.body.data.id))!
    expect(xmlOf(uploaded.content)).toContain('marcador-comodin')
  })

  it('con una plantilla exacta Y un comodín para el mismo tipo: gana la exacta', async () => {
    await upload(markedTemplate('marcador-comodin'), { type: 'COMPLIANCE' })
    const ctx = await startedAudit(t, 'CONFORMITY', '-exacta')
    await upload(markedTemplate('marcador-exacto'), { type: 'COMPLIANCE', scaleId: ctx.lib.scale.id })
    await closeAudit(ctx.auditId)
    const res = await generate(ctx.auditId, 'COMPLIANCE')
    const uploaded = t.storage.uploaded.find((u) => u.path.includes(res.body.data.id))!
    const xml = xmlOf(uploaded.content)
    expect(xml).toContain('marcador-exacto')
    expect(xml).not.toContain('marcador-comodin')
  })

  it('una plantilla para OTRA escala de la misma dimensión no aplica', async () => {
    const otra = await db.scale.create({ data: { name: 'Otra conformidad', dimension: 'CONFORMITY' } })
    await upload(markedTemplate('marcador-otra-escala'), { type: 'COMPLIANCE', scaleId: otra.id })
    const ctx = await startedAudit(t, 'CONFORMITY', '-otra-escala')
    await closeAudit(ctx.auditId)
    const res = await generate(ctx.auditId, 'COMPLIANCE')
    const uploaded = t.storage.uploaded.find((u) => u.path.includes(res.body.data.id))!
    expect(xmlOf(uploaded.content)).not.toContain('marcador-otra-escala')
  })

  it('la plantilla de otro tipo de informe no aplica', async () => {
    await upload(markedTemplate('marcador-gap-analysis'), { type: 'GAP_ANALYSIS' })
    const ctx = await startedAudit(t, 'CONFORMITY', '-otro-tipo')
    await closeAudit(ctx.auditId)
    const res = await generate(ctx.auditId, 'COMPLIANCE')
    const uploaded = t.storage.uploaded.find((u) => u.path.includes(res.body.data.id))!
    expect(xmlOf(uploaded.content)).not.toContain('marcador-gap-analysis')
  })
})
