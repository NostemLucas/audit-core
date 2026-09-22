import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { evidenceFolder } from '../../src/platform/nextcloud/index.js'
import { signWebhook } from '../../src/platform/nextcloud/webhook-signature.js'
import { type TestRole, useTestApi } from './support/api.js'
import { startedAudit, type StartedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'
const WEBHOOK_SECRET = 'test-webhook-secret' // ver test/support/env.ts

const t = useTestApi()
const { api, as, db, storage } = t

const evalOf = (auditId: string, title: string) =>
  db.evaluation.findFirstOrThrow({ where: { auditId, control: { title } } })
const evidenceUrl = (ctx: StartedAudit, evaluationId: string, suffix = '') =>
  `${A}/${ctx.auditId}/evaluations/${evaluationId}/evidence${suffix}`

/** Arranca el criterio (NOT_STARTED → IN_PROGRESS) con una edición trivial: la evidencia exige esa misma ventana. */
const start = async (ctx: StartedAudit, evaluationId: string) => {
  const row = await db.evaluation.findUniqueOrThrow({ where: { id: evaluationId } })
  await api()
    .patch(`${A}/${ctx.auditId}/evaluations/${evaluationId}`)
    .set('authorization', await as('auditor', 'ana'))
    .send({ notes: 'en curso', version: row.version })
}

const requestUpload = async (ctx: StartedAudit, evaluationId: string, role: TestRole = 'auditor', who = 'ana') =>
  api()
    .post(evidenceUrl(ctx, evaluationId, '/upload-target'))
    .set('authorization', await as(role, who))

const list = async (ctx: StartedAudit, evaluationId: string, role: TestRole = 'auditor', who = 'ana') =>
  api()
    .get(evidenceUrl(ctx, evaluationId))
    .set('authorization', await as(role, who))

const remove = async (
  ctx: StartedAudit,
  evaluationId: string,
  evidenceId: string,
  role: TestRole = 'auditor',
  who = 'ana',
) =>
  api()
    .delete(evidenceUrl(ctx, evaluationId, `/${evidenceId}`))
    .set('authorization', await as(role, who))

/** Un envío válido del webhook, firmado como lo exige `verifyWebhookSignature` (docs/07 §1.2). */
function webhookPayload(evaluationId: string, extra: Record<string, unknown> = {}) {
  return {
    path: `/Auditorias/AUD-2026-00001/Evidencias/${evaluationId}/acta-comite.pdf`,
    fileId: `nc-${Math.random().toString(36).slice(2)}`,
    fileName: 'acta-comite.pdf',
    mimeType: 'application/pdf',
    size: 245678,
    ...extra,
  }
}

const postWebhook = (body: Record<string, unknown>, signature?: string) => {
  const raw = JSON.stringify(body)
  const sig = signature === undefined ? `sha256=${signWebhook(WEBHOOK_SECRET, raw)}` : signature
  const req = api().post('/api/v1/webhooks/nextcloud/evidence').set('content-type', 'application/json')
  if (sig) req.set('x-nextcloud-signature', sig)
  return req.send(raw)
}

describe('pedir un lugar para subir (POST .../evidence/upload-target)', () => {
  it('el auditor asignado obtiene la URL del share; la carpeta pedida sale del código de la auditoría y el criterio', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    const res = await requestUpload(ctx, roles.id)
    expect(res.status).toBe(201)
    expect(res.body.data.url).toMatch(/^https:\/\/nextcloud\.test\/s\/upload-/)
    const code = (await db.audit.findUniqueOrThrow({ where: { id: ctx.auditId } })).code
    expect(storage.uploadTargets).toContain(evidenceFolder(code, roles.id))
  })

  it('otro auditor, el líder, el manager y el ADMIN no piden lugar para un criterio ajeno: 403', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    for (const [role, who] of [
      ['auditor', 'luis'],
      ['auditor', 'lider'],
      ['manager', 'manager'],
      ['admin', 'admin'],
    ] as const) {
      expect((await requestUpload(ctx, roles.id, role, who)).status, `${role}/${who}`).toBe(403)
    }
    expect(storage.uploadTargets).toHaveLength(0)
  })

  it('sin arrancar el criterio (NOT_STARTED), enviado a revisión o aprobado: 409 EVIDENCE_LOCKED; en RETURNED sí', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const notStarted = await requestUpload(ctx, roles.id)
    expect(notStarted.status).toBe(409)
    expect(notStarted.body.error.code).toBe('EVIDENCE_LOCKED')

    for (const status of ['COMPLETED', 'APPROVED'] as const) {
      await db.evaluation.update({ where: { id: roles.id }, data: { status } })
      expect((await requestUpload(ctx, roles.id)).body.error.code).toBe('EVIDENCE_LOCKED')
    }
    await db.evaluation.update({ where: { id: roles.id }, data: { status: 'RETURNED' } })
    expect((await requestUpload(ctx, roles.id)).status).toBe(201)
  })

  it('con la auditoría fuera de curso: 409 AUDIT_NOT_EVALUABLE; un criterio inexistente o de otra auditoría: 404', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await db.audit.update({ where: { id: ctx.auditId }, data: { status: 'CLOSED' } })
    expect((await requestUpload(ctx, roles.id)).body.error.code).toBe('AUDIT_NOT_EVALUABLE')

    // un criterio inexistente, con la auditoría SÍ evaluable (si no, gana el 409 de la auditoría, no el 404 del criterio)
    const other = await startedAudit(t, 'CONFORMITY', '-2')
    expect((await requestUpload(other, UNKNOWN_ID)).status).toBe(404)
  })
})

describe('el webhook de Nextcloud (POST /webhooks/nextcloud/evidence)', () => {
  it('registra la evidencia con firma válida, SIN ningún encabezado de autorización (es una ruta pública)', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id) // arranca el criterio (IN_PROGRESS)
    const anaId = (await db.evaluation.findUniqueOrThrow({ where: { id: roles.id } })).assignedUserId
    const payload = webhookPayload(roles.id)
    const res = await postWebhook(payload)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      title: 'acta-comite',
      fileName: 'acta-comite.pdf',
      mimeType: 'application/pdf',
      size: 245678,
      createdById: anaId, // el webhook no dice quién subió: se infiere del asignado (docs/07 §1.2)
    })
    const row = await db.evidence.findUniqueOrThrow({ where: { storageFileId: payload.fileId } })
    expect(row.evaluationId).toBe(roles.id)
    expect(row.deletedAt).toBeNull()
  })

  it('sin firma, con una firma que no corresponde, o con el secreto equivocado: 401 WEBHOOK_SIGNATURE_INVALID', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    const payload = webhookPayload(roles.id)
    expect((await postWebhook(payload, '')).status).toBe(401)
    expect((await postWebhook(payload, 'sha256=' + '0'.repeat(64))).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID')
    const wrongSecret = `sha256=${signWebhook('otro-secreto', JSON.stringify(payload))}`
    expect((await postWebhook(payload, wrongSecret)).status).toBe(401)
    expect(await db.evidence.count()).toBe(0)
  })

  it('la firma es sobre el cuerpo EXACTO enviado: cambiar un campo después de firmar invalida la firma', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    const original = webhookPayload(roles.id)
    const signature = `sha256=${signWebhook(WEBHOOK_SECRET, JSON.stringify(original))}`
    const tampered = { ...original, size: 999 }
    expect((await postWebhook(tampered, signature)).status).toBe(401)
  })

  it('un cuerpo que no cumple el contrato (falta un campo): 400 VALIDATION_FAILED', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    const { fileId: _fileId, ...incomplete } = webhookPayload(roles.id)
    expect((await postWebhook(incomplete)).status).toBe(400)
  })

  it('una ruta que no tiene la forma ".../Evidencias/{id}/...": 422 EVIDENCE_PATH_INVALID', async () => {
    const res = await postWebhook(webhookPayload('x', { path: '/Auditorias/AUD-1/Informes/algo.docx' }))
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('EVIDENCE_PATH_INVALID')
  })

  it('un criterio que no existe (id bien formado pero inventado): 404 EVALUATION_NOT_FOUND', async () => {
    const res = await postWebhook(webhookPayload(UNKNOWN_ID))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('EVALUATION_NOT_FOUND')
  })

  it('un criterio sin arrancar, enviado a revisión o aprobado: 409 EVIDENCE_LOCKED (no se registra)', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const notStarted = await postWebhook(webhookPayload(roles.id))
    expect(notStarted.status).toBe(409)
    expect(notStarted.body.error.code).toBe('EVIDENCE_LOCKED')
    await db.evaluation.update({ where: { id: roles.id }, data: { status: 'APPROVED' } })
    expect((await postWebhook(webhookPayload(roles.id))).body.error.code).toBe('EVIDENCE_LOCKED')
    expect(await db.evidence.count()).toBe(0)
  })

  it('el mismo archivo entregado dos veces (reintento de Nextcloud) es idempotente: 200, sin duplicar la fila', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    const payload = webhookPayload(roles.id)
    const first = await postWebhook(payload)
    const second = await postWebhook(payload)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.data.id).toBe(first.body.data.id)
    expect(await db.evidence.count({ where: { storageFileId: payload.fileId } })).toBe(1)
  })
})

describe('ver la evidencia de un criterio', () => {
  it('la ven todos los que ven la auditoría; un auditor ajeno recibe 403; un criterio inexistente, 404', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    await postWebhook(webhookPayload(roles.id))
    for (const [role, who] of [
      ['auditor', 'ana'],
      ['auditor', 'luis'],
      ['auditor', 'lider'],
      ['manager', 'manager'],
      ['admin', 'admin'],
    ] as const) {
      const res = await list(ctx, roles.id, role, who)
      expect(res.status, `${role}/${who}`).toBe(200)
      expect(res.body.data).toHaveLength(1)
    }
    expect((await list(ctx, roles.id, 'auditor', 'ajeno')).status).toBe(403)
    expect((await list(ctx, UNKNOWN_ID)).status).toBe(404)
  })

  it('una evidencia eliminada no aparece en la lista', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await start(ctx, roles.id)
    const payload = webhookPayload(roles.id)
    await postWebhook(payload)
    const evidenceId = (await db.evidence.findUniqueOrThrow({ where: { storageFileId: payload.fileId } })).id
    expect((await remove(ctx, roles.id, evidenceId)).status).toBe(204)
    expect((await list(ctx, roles.id)).body.data).toHaveLength(0)
  })
})

describe('eliminar una evidencia (soft-delete)', () => {
  async function withEvidence(ctx: StartedAudit, evaluationId: string) {
    await start(ctx, evaluationId)
    const payload = webhookPayload(evaluationId)
    await postWebhook(payload)
    return (await db.evidence.findUniqueOrThrow({ where: { storageFileId: payload.fileId } })).id
  }

  it('el auditor asignado la elimina; la fila queda (deletedAt), nunca se borra', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const evidenceId = await withEvidence(ctx, roles.id)
    const res = await remove(ctx, roles.id, evidenceId)
    expect(res.status).toBe(204)
    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } })
    expect(row.deletedAt).not.toBeNull()
  })

  it('baja el `evidenceCount` del criterio: la regla de envío (docs/06 §3) lo nota', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const evidenceId = await withEvidence(ctx, roles.id)
    const ana = await as('auditor', 'ana')
    await api()
      .patch(`${A}/${ctx.auditId}/evaluations/${roles.id}`)
      .set('authorization', ana)
      .send({
        achievedLevelId: (await db.evaluation.findUniqueOrThrow({ where: { id: roles.id } })).expectedLevelId,
        version: (await db.evaluation.findUniqueOrThrow({ where: { id: roles.id } })).version,
      })
    const before = await api().get(`${A}/${ctx.auditId}/evaluations/${roles.id}`).set('authorization', ana)
    expect(before.body.data.evidenceCount).toBe(1)
    expect((await remove(ctx, roles.id, evidenceId)).status).toBe(204)
    const after = await api().get(`${A}/${ctx.auditId}/evaluations/${roles.id}`).set('authorization', ana)
    expect(after.body.data.evidenceCount).toBe(0)
  })

  it('otro auditor, el líder, el manager y el ADMIN no eliminan la evidencia de un criterio ajeno: 403', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const evidenceId = await withEvidence(ctx, roles.id)
    for (const [role, who] of [
      ['auditor', 'luis'],
      ['auditor', 'lider'],
      ['manager', 'manager'],
      ['admin', 'admin'],
    ] as const) {
      expect((await remove(ctx, roles.id, evidenceId, role, who)).status, `${role}/${who}`).toBe(403)
    }
    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } })
    expect(row.deletedAt).toBeNull()
  })

  it('enviado a revisión o aprobado: 409 EVIDENCE_LOCKED (no se elimina)', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const evidenceId = await withEvidence(ctx, roles.id)
    for (const status of ['COMPLETED', 'APPROVED'] as const) {
      await db.evaluation.update({ where: { id: roles.id }, data: { status } })
      expect((await remove(ctx, roles.id, evidenceId)).body.error.code).toBe('EVIDENCE_LOCKED')
    }
  })

  it('una evidencia inexistente, ya eliminada, o de otro criterio: 404', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const evidenceId = await withEvidence(ctx, roles.id)
    expect((await remove(ctx, roles.id, UNKNOWN_ID)).status).toBe(404)
    const politicas = await evalOf(ctx.auditId, 'Políticas')
    await start(ctx, politicas.id)
    expect((await remove(ctx, politicas.id, evidenceId)).status).toBe(404) // es de "Roles", no de "Políticas"
    await remove(ctx, roles.id, evidenceId)
    expect((await remove(ctx, roles.id, evidenceId)).status).toBe(404) // ya eliminada
  })
})

describe('de punta a punta', () => {
  it('pedir lugar → el webhook la registra → aparece en la lista y en el criterio → se envía a revisión con ella', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const ana = await as('auditor', 'ana')
    const before = await db.evaluation.findUniqueOrThrow({ where: { id: roles.id } })

    // fijar el nivel alcanzado arranca el criterio (NOT_STARTED → IN_PROGRESS): ya se puede pedir evidencia
    await api()
      .patch(`${A}/${ctx.auditId}/evaluations/${roles.id}`)
      .set('authorization', ana)
      .send({ achievedLevelId: before.expectedLevelId, version: before.version })

    const target = await requestUpload(ctx, roles.id)
    expect(target.status).toBe(201)
    const payload = webhookPayload(roles.id)
    expect((await postWebhook(payload)).status).toBe(200)

    const complete = await api().post(`${A}/${ctx.auditId}/evaluations/${roles.id}/complete`).set('authorization', ana)
    expect(complete.status).toBe(200)
    expect(complete.body.data.evidenceCount).toBe(1)
  })
})
