import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { auditBody, type LibraryFixture, libraryFixture } from './support/audits.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

async function newAudit(
  dimension: 'CONFORMITY' | 'MATURITY' = 'CONFORMITY',
  suffix = '',
): Promise<{ id: string; lib: LibraryFixture }> {
  const lib = await libraryFixture(db, suffix, dimension)
  const res = await api()
    .post(A)
    .set('authorization', await as('manager'))
    .send(auditBody(lib))
  return { id: res.body.data.id, lib }
}
async function staff(auditId: string, opts: { lead?: boolean; member?: boolean } = { lead: true, member: true }) {
  const auth = await as('manager')
  if (opts.lead !== false)
    await api()
      .post(`${A}/${auditId}/members`)
      .set('authorization', auth)
      .send({ userId: await t.userId('auditor', 'lider'), role: 'LEAD' })
  if (opts.member !== false)
    await api()
      .post(`${A}/${auditId}/members`)
      .set('authorization', auth)
      .send({ userId: await t.userId('auditor', 'ana'), role: 'MEMBER' })
}
const assignAll = async (auditId: string) => {
  const ids = (await db.evaluation.findMany({ where: { auditId }, select: { id: true } })).map((e) => e.id)
  await api()
    .put(`${A}/${auditId}/assignments`)
    .set('authorization', await as('auditor', 'lider'))
    .send({ evaluationIds: ids, userId: await t.userId('auditor', 'ana') })
}
const start = async (auditId: string, role: TestRole = 'manager', who?: string) =>
  api()
    .post(`${A}/${auditId}/start`)
    .set('authorization', await as(role, who))
const close = async (auditId: string, role: TestRole = 'manager', who?: string) =>
  api()
    .post(`${A}/${auditId}/close`)
    .set('authorization', await as(role, who))
const archive = async (auditId: string, role: TestRole = 'manager', who?: string) =>
  api()
    .post(`${A}/${auditId}/archive`)
    .set('authorization', await as(role, who))
const events = (auditId: string) => db.auditEvent.findMany({ where: { auditId }, orderBy: { createdAt: 'asc' } })
const eventsOfType = async (auditId: string, type: string) => (await events(auditId)).filter((e) => e.type === type)

describe('nivel esperado según la dimensión de la escala (docs/06 §2)', () => {
  it('CONFORMITY: se fija solo, al puntaje más alto, sin que el líder haga nada', async () => {
    const { id, lib } = await newAudit('CONFORMITY')
    const rows = await db.evaluation.findMany({ where: { auditId: id }, include: { expectedLevel: true } })
    expect(rows.every((r) => r.expectedLevel?.label === 'Cumple' && r.expectedLevel.value.toNumber() === 100)).toBe(
      true,
    )
    expect(lib.scale.levels.at(-1)!.label).toBe('Cumple')
  })

  it('MATURITY: queda vacío al crear; iniciar sin fijarlo todo falla', async () => {
    const { id } = await newAudit('MATURITY')
    const rows = await db.evaluation.findMany({ where: { auditId: id } })
    expect(rows.every((r) => r.expectedLevelId === null)).toBe(true)
    await staff(id)
    await assignAll(id)
    const res = await start(id)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('AUDIT_EXPECTED_LEVELS_MISSING')
    expect(res.body.error.details.missing).toBe(4)
  })
})

describe('fijar el nivel esperado (el líder, uno a uno o en bloque)', () => {
  it('el líder lo fija en una auditoría MATURITY; la lista lo muestra con su guía', async () => {
    const { id, lib } = await newAudit('MATURITY')
    await staff(id)
    const ids = (await db.evaluation.findMany({ where: { auditId: id }, select: { id: true } })).map((e) => e.id)
    const target = lib.scale.levels.find((l) => l.label === 'Parcial')!
    const res = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: ids, expectedLevelId: target.id, guidance: 'Criticidad media' })
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(4)
    expect(
      res.body.data.every(
        (e: { expectedLevel: { id: string }; guidance: string }) =>
          e.expectedLevel.id === target.id && e.guidance === 'Criticidad media',
      ),
    ).toBe(true)

    const history = await eventsOfType(id, 'EvaluationExpectedLevelSet')
    expect(history).toHaveLength(4)
    expect(renderEventMessage('EvaluationExpectedLevelSet', history[0]!.payload)).toMatch(/^Fijó el nivel esperado de/)
  })

  it('el líder puede AJUSTAR el nivel esperado incluso en una auditoría CONFORMITY (excepción documentada)', async () => {
    const { id, lib } = await newAudit('CONFORMITY')
    await staff(id)
    const evaluation = await db.evaluation.findFirstOrThrow({ where: { auditId: id } })
    const lower = lib.scale.levels.find((l) => l.label === 'Parcial')!
    const res = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', await as('auditor', 'lider'))
      .send({
        evaluationIds: [evaluation.id],
        expectedLevelId: lower.id,
        guidance: 'Sistema legado, se acepta parcial',
      })
    expect(res.status).toBe(200)
    expect(res.body.data[0].expectedLevel.label).toBe('Parcial')
    const event = (await events(id)).find((e) => e.type === 'EvaluationExpectedLevelSet')!
    expect(renderEventMessage(event.type, event.payload)).toMatch(/^Cambió el nivel esperado de/)
  })

  it('idempotente: el mismo nivel y la misma guía no dejan rastro; solo la guía sí cuenta como cambio', async () => {
    const { id, lib } = await newAudit('MATURITY')
    await staff(id)
    const evaluation = await db.evaluation.findFirstOrThrow({ where: { auditId: id } })
    const level = lib.scale.levels[0]!
    const auth = await as('auditor', 'lider')
    await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: level.id, guidance: 'x' })
    const same = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: level.id, guidance: 'x' })
    expect(same.body.data).toEqual([])
    const onlyGuidance = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: level.id, guidance: 'y' })
    expect(onlyGuidance.body.data).toHaveLength(1)
    expect(await eventsOfType(id, 'EvaluationExpectedLevelSet')).toHaveLength(2)
  })

  it('sin guidance en el cuerpo no la toca al cambiar de nivel; con guidance vacío la borra', async () => {
    const { id, lib } = await newAudit('MATURITY')
    await staff(id)
    const evaluation = await db.evaluation.findFirstOrThrow({ where: { auditId: id } })
    const auth = await as('auditor', 'lider')
    await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: lib.scale.levels[0]!.id, guidance: 'x' })
    // cambia de nivel (0 -> 1) sin enviar guidance: la guía se conserva
    const untouched = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: lib.scale.levels[1]!.id })
    expect(untouched.body.data).toHaveLength(1) // el nivel sí cambió
    expect(untouched.body.data[0].guidance).toBe('x')
    // mismo nivel (1), guidance vacío en el cuerpo: la borra
    const cleared = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: lib.scale.levels[1]!.id, guidance: '' })
    expect(cleared.body.data).toHaveLength(1)
    expect((await db.evaluation.findUniqueOrThrow({ where: { id: evaluation.id } })).guidance).toBeNull()
  })

  it('un nivel de OTRA escala: 422 EVALUATION_LEVEL_NOT_IN_SCALE; criterio de otra auditoría: 404; solo el líder: 403', async () => {
    const { id } = await newAudit('MATURITY')
    await staff(id)
    const other = await libraryFixture(db, '-2', 'MATURITY')
    const evaluation = await db.evaluation.findFirstOrThrow({ where: { auditId: id } })
    const auth = await as('auditor', 'lider')
    const foreign = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [evaluation.id], expectedLevelId: other.scale.levels[0]!.id })
    expect(foreign.status).toBe(422)
    expect(foreign.body.error.code).toBe('EVALUATION_LEVEL_NOT_IN_SCALE')
    const missing = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', auth)
      .send({ evaluationIds: [UNKNOWN_ID], expectedLevelId: other.scale.levels[0]!.id })
    expect(missing.status).toBe(422) // se valida el nivel antes que los ids
    const notLead = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', await as('manager'))
      .send({ evaluationIds: [evaluation.id], expectedLevelId: other.scale.levels[0]!.id })
    expect(notLead.status).toBe(403)
  })

  it('un criterio enviado a revisión o aprobado: 409 EVALUATION_EXPECTED_LEVEL_LOCKED, todo o nada', async () => {
    const { id, lib } = await newAudit('MATURITY')
    await staff(id)
    const [free, sent] = await db.evaluation.findMany({ where: { auditId: id }, take: 2 })
    await db.evaluation.update({ where: { id: sent!.id }, data: { status: 'COMPLETED' } })
    const res = await api()
      .put(`${A}/${id}/expected-levels`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: [free!.id, sent!.id], expectedLevelId: lib.scale.levels[0]!.id })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'EVALUATION_EXPECTED_LEVEL_LOCKED',
      details: { evaluationIds: [sent!.id] },
    })
    expect((await db.evaluation.findUniqueOrThrow({ where: { id: free!.id } })).expectedLevelId).toBeNull()
  })
})

describe('iniciar (solo el manager)', () => {
  it('con todo listo pasa a IN_PROGRESS y lo registra', async () => {
    const { id } = await newAudit('CONFORMITY')
    await staff(id)
    await assignAll(id)
    const res = await start(id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'IN_PROGRESS', allowedActions: ['CLOSE'] })
    expect(renderEventMessage('AuditStarted', (await events(id)).find((e) => e.type === 'AuditStarted')!.payload)).toBe(
      'Inició la auditoría',
    )
  })

  it('sin líder: 422 AUDIT_HAS_NO_LEAD; sin auditores: 422 AUDIT_HAS_NO_MEMBERS', async () => {
    const { id } = await newAudit()
    const noLead = await start(id)
    expect(noLead.status).toBe(422)
    expect(noLead.body.error.code).toBe('AUDIT_HAS_NO_LEAD')
    await staff(id, { lead: true, member: false })
    const noMembers = await start(id)
    expect(noMembers.body.error.code).toBe('AUDIT_HAS_NO_MEMBERS')
  })

  it('con criterios sin asignar: 422 AUDIT_UNASSIGNED_EVALUATIONS con cuántos faltan', async () => {
    const { id } = await newAudit()
    await staff(id)
    const res = await start(id)
    expect(res.status).toBe(422)
    expect(res.body.error).toMatchObject({ code: 'AUDIT_UNASSIGNED_EVALUATIONS', details: { missing: 4 } })
  })

  it('el orden de las precondiciones: el ciclo de vida gana a todo lo demás (una IN_PROGRESS vacía da INVALID_STATE)', async () => {
    const { id } = await newAudit()
    await db.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } })
    const res = await start(id)
    expect(res.body.error.code).toBe('AUDIT_INVALID_STATE')
  })

  it('solo el manager: otro GERENTE y el líder 403', async () => {
    const { id } = await newAudit()
    await staff(id)
    await assignAll(id)
    expect((await start(id, 'manager', 'otro')).status).toBe(403)
    expect((await start(id, 'auditor', 'lider')).status).toBe(403)
    expect((await db.audit.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT')
  })
})

describe('cerrar (solo el manager)', () => {
  async function inProgress() {
    const { id } = await newAudit('CONFORMITY')
    await staff(id)
    await assignAll(id)
    await start(id)
    return id
  }

  it('con todos los criterios aprobados: cierra, pone closedAt y lo registra', async () => {
    const id = await inProgress()
    await db.evaluation.updateMany({ where: { auditId: id }, data: { status: 'APPROVED' } })
    const res = await close(id)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CLOSED')
    expect(res.body.data.closedAt).not.toBeNull()
    expect(res.body.data.allowedActions).toEqual(['ARCHIVE'])
    expect(renderEventMessage('AuditClosed', (await events(id)).find((e) => e.type === 'AuditClosed')!.payload)).toBe(
      'Cerró la auditoría',
    )
  })

  it('con criterios pendientes: 422 con cuántos faltan (incluye los "no aplica", que también deben aprobarse)', async () => {
    const id = await inProgress()
    const rows = await db.evaluation.findMany({ where: { auditId: id } })
    await db.evaluation.update({ where: { id: rows[0]!.id }, data: { status: 'APPROVED' } })
    await db.evaluation.update({
      where: { id: rows[1]!.id },
      data: { status: 'APPROVED', isNotApplicable: true, notApplicableReason: 'x' },
    })
    // los otros dos NO están en NOT_STARTED (para que "pendiente" sea de verdad "!= APPROVED", no solo "== NOT_STARTED")
    await db.evaluation.update({ where: { id: rows[2]!.id }, data: { status: 'IN_PROGRESS' } })
    await db.evaluation.update({ where: { id: rows[3]!.id }, data: { status: 'COMPLETED' } })
    const res = await close(id)
    expect(res.status).toBe(422)
    expect(res.body.error).toMatchObject({ code: 'AUDIT_HAS_PENDING_EVALUATIONS', details: { pending: 2 } })
  })

  it('solo el manager; solo en curso (borrador: 409)', async () => {
    const { id: draftId } = await newAudit('CONFORMITY', '-draft')
    expect((await close(draftId)).body.error.code).toBe('AUDIT_INVALID_STATE')
    const inp = await inProgress()
    await db.evaluation.updateMany({ where: { auditId: inp }, data: { status: 'APPROVED' } })
    expect((await close(inp, 'manager', 'otro')).status).toBe(403)
    expect((await db.audit.findUniqueOrThrow({ where: { id: inp } })).status).toBe('IN_PROGRESS')
  })
})

describe('archivar (solo el manager)', () => {
  it('desde cerrada: pasa a ARCHIVED, estado final, y lo registra', async () => {
    const { id } = await newAudit()
    await staff(id)
    await assignAll(id)
    await start(id)
    await db.evaluation.updateMany({ where: { auditId: id }, data: { status: 'APPROVED' } })
    await close(id)
    const res = await archive(id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'ARCHIVED', allowedActions: [] })
    expect(
      renderEventMessage('AuditArchived', (await events(id)).find((e) => e.type === 'AuditArchived')!.payload),
    ).toBe('Archivó la auditoría')
  })

  it('solo desde cerrada (borrador: 409); solo el manager', async () => {
    const { id } = await newAudit()
    expect((await archive(id)).body.error.code).toBe('AUDIT_INVALID_STATE')
  })
})
