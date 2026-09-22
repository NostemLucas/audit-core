import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { auditBody, LEAF_TITLES, type LibraryFixture, libraryFixture } from './support/audits.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

let lib: LibraryFixture
let auditId: string
let ana: string // auditora
let luis: string // auditor
let lead: string // líder
beforeEach(async () => {
  lib = await libraryFixture(db)
  auditId = (
    await api()
      .post(A)
      .set('authorization', await as('manager'))
      .send(auditBody(lib))
  ).body.data.id
  ;[ana, luis, lead] = await Promise.all([
    t.userId('auditor', 'ana'),
    t.userId('auditor', 'luis'),
    t.userId('auditor', 'lider'),
  ])
  await db.auditMember.createMany({
    data: [
      { auditId, userId: ana, role: 'MEMBER' },
      { auditId, userId: luis, role: 'MEMBER' },
      { auditId, userId: lead, role: 'LEAD' },
    ],
  })
})

const list = async (query: Record<string, unknown> = {}, role: TestRole = 'auditor', who = 'lider') =>
  api()
    .get(`${A}/${auditId}/evaluations`)
    .query(query)
    .set('authorization', await as(role, who))
const assign = async (evaluationIds: string[], userId: string | null, role: TestRole = 'auditor', who = 'lider') =>
  api()
    .put(`${A}/${auditId}/assignments`)
    .set('authorization', await as(role, who))
    .send({ evaluationIds, userId })
const evaluationOf = async (title: string) =>
  (await db.evaluation.findFirstOrThrow({ where: { auditId, control: { title } } })).id
const events = () =>
  db.auditEvent.findMany({ where: { auditId, type: { startsWith: 'Evaluation' } }, orderBy: { createdAt: 'asc' } })

describe('ver los criterios', () => {
  it('lista plana en orden de lectura, con el criterio, su dominio y quién lo tiene', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    expect(res.body.data.map((e: { control: { title: string } }) => e.control.title)).toEqual(LEAF_TITLES)
    expect(res.body.data.map((e: { control: { domain: string } }) => e.control.domain)).toEqual([
      'Organizacionales',
      'Organizacionales',
      'Personas',
      'Personas',
    ])
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      control: { id: expect.any(String), reference: 'A.5.1', title: 'Políticas', domain: 'Organizacionales' },
      status: 'NOT_STARTED',
      assignedUser: null,
      // la escala de la fixture es CONFORMITY: el nivel esperado se fija solo, al puntaje más alto (docs/06 §2)
      expectedLevel: { id: expect.any(String), value: 100, label: 'Cumple' },
      guidance: null,
      achievedLevel: null,
      findings: null,
      severity: null,
      notes: null,
      isNotApplicable: false,
      notApplicableReason: null,
      evidenceCount: 0,
      carriedFromId: null,
      requiresFollowUp: false,
      version: 0,
    })
    expect(res.body.data[2].control.reference).toBeNull()
  })

  it('filtra por auditor, por sin asignar y por estado', async () => {
    await db.evaluation.update({
      where: { id: await evaluationOf('Roles') },
      data: { assignedUserId: ana, status: 'IN_PROGRESS' },
    })
    await db.evaluation.update({ where: { id: await evaluationOf('Contratos') }, data: { assignedUserId: luis } })
    const titles = (r: { body: { data: Array<{ control: { title: string } }> } }) =>
      r.body.data.map((e) => e.control.title)
    expect(titles(await list({ assignedTo: ana }))).toEqual(['Roles'])
    expect(titles(await list({ unassigned: 'true' }))).toEqual(['Políticas', 'Antecedentes'])
    expect(titles(await list({ status: 'IN_PROGRESS' }))).toEqual(['Roles'])
    expect((await list({ status: 'X' })).status).toBe(400)
  })

  it('lo ven el manager, los miembros (todos los criterios) y el ADMIN; un auditor ajeno no (403); inexistente 404', async () => {
    expect((await list({}, 'manager', 'manager')).status).toBe(200)
    expect((await list({}, 'auditor', 'ana')).body.data).toHaveLength(4) // un auditor ve todo, edita solo lo suyo
    expect((await list({}, 'admin', 'admin')).status).toBe(200)
    expect((await list({}, 'auditor', 'ajeno')).status).toBe(403)
    expect(
      (
        await api()
          .get(`${A}/${UNKNOWN_ID}/evaluations`)
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(404)
  })
})

it('el orden de lectura es el de la plantilla AHORA, no el de inserción: si el árbol se reordena después, la lista lo refleja', async () => {
  const T = '/api/v1/templates'
  const auth = await as('manager')
  const politicas = await db.control.findFirstOrThrow({ where: { templateId: lib.template.id, title: 'Políticas' } })
  // Mover "Políticas" al final de su grupo, después de crear la auditoría: la inserción de evaluations ya no coincide
  // con el orden de lectura actual.
  await db.template.update({ where: { id: lib.template.id }, data: { status: 'DRAFT' } })
  const move = await api()
    .post(`${T}/${lib.template.id}/controls/${politicas.id}/move`)
    .set('authorization', auth)
    .send({ parentId: politicas.parentId, position: 1 })
  expect(move.status).toBe(200)
  await db.template.update({ where: { id: lib.template.id }, data: { status: 'PUBLISHED' } })

  const res = await list()
  expect(res.body.data.map((e: { control: { title: string } }) => e.control.title)).toEqual([
    'Roles',
    'Políticas',
    'Antecedentes',
    'Contratos',
  ])
})

describe('asignar criterios (solo el líder)', () => {
  it('el líder asigna varios criterios a un auditor; devuelve lo que cambió y lo deja en el historial del criterio', async () => {
    const ids = [await evaluationOf('Políticas'), await evaluationOf('Roles')]
    const res = await assign(ids, ana)
    expect(res.status).toBe(200)
    expect(
      res.body.data.map((e: { control: { title: string }; assignedUser: { name: string } }) => [
        e.control.title,
        e.assignedUser.name,
      ]),
    ).toEqual([
      ['Políticas', 'ana'],
      ['Roles', 'ana'],
    ])
    expect((await list({ assignedTo: ana })).body.data).toHaveLength(2)
    const history = await events()
    expect(history.map((e) => [e.type, e.subjectType, e.targetUserId])).toEqual([
      ['EvaluationAssigned', 'Evaluation', ana],
      ['EvaluationAssigned', 'Evaluation', ana],
    ])
    expect(history.map((e) => renderEventMessage(e.type, e.payload))).toEqual([
      'Asignó «Políticas» a ana',
      'Asignó «Roles» a ana',
    ])
    const leadUser = await db.user.findUniqueOrThrow({ where: { id: lead } })
    expect(history[0]!.actorId).toBe(leadUser.id)
  })

  it('reasignar cambia de dueño y lo cuenta; volver a asignar lo mismo es idempotente y no deja rastro', async () => {
    const id = await evaluationOf('Políticas')
    await assign([id], ana)
    const again = await assign([id], ana)
    expect(again.status).toBe(200)
    expect(again.body.data).toEqual([])
    expect((await events()).length).toBe(1)
    const moved = await assign([id], luis)
    expect(moved.body.data[0].assignedUser.name).toBe('luis')
    const last = (await events()).at(-1)!
    expect(renderEventMessage(last.type, last.payload)).toBe('Reasignó «Políticas» de ana a luis')
  })

  it('userId null deja los criterios sin asignar (y lo registra con quién lo tenía)', async () => {
    const id = await evaluationOf('Roles')
    await assign([id], ana)
    const res = await assign([id], null)
    expect(res.status).toBe(200)
    expect(res.body.data[0].assignedUser).toBeNull()
    const last = (await events()).at(-1)!
    expect(last).toMatchObject({ type: 'EvaluationUnassigned', targetUserId: ana })
    expect(renderEventMessage(last.type, last.payload)).toBe('Quitó la asignación de «Roles» (era de ana)')
    expect((await assign([id], null)).body.data).toEqual([]) // ya sin asignar: nada
  })

  it('solo a un AUDITOR del equipo: al líder o a quien no es miembro es 422 EVALUATION_ASSIGNEE_INVALID', async () => {
    const id = await evaluationOf('Roles')
    const toLead = await assign([id], lead)
    expect(toLead.status).toBe(422)
    expect(toLead.body.error).toMatchObject({ code: 'EVALUATION_ASSIGNEE_INVALID', details: { reason: 'IS_LEAD' } })
    const outsider = await t.userId('auditor', 'ajeno')
    expect((await assign([id], outsider)).body.error.details.reason).toBe('NOT_IN_TEAM')
    expect((await assign([id], UNKNOWN_ID)).body.error.details.reason).toBe('NOT_IN_TEAM')
    expect(await db.evaluation.count({ where: { assignedUserId: { not: null } } })).toBe(0)
  })

  it('criterios que no son de la auditoría: 404 con la lista; y no se asigna ninguno (todo o nada)', async () => {
    const mine = await evaluationOf('Roles')
    const other = await libraryFixture(db, '-2')
    const otherAudit = (
      await api()
        .post(A)
        .set('authorization', await as('manager'))
        .send(auditBody(other))
    ).body.data.id
    const foreign = (await db.evaluation.findFirstOrThrow({ where: { auditId: otherAudit } })).id
    const res = await assign([mine, foreign, UNKNOWN_ID], ana)
    expect(res.status).toBe(404)
    expect(res.body.error).toMatchObject({
      code: 'EVALUATION_NOT_FOUND',
      details: { evaluationIds: [foreign, UNKNOWN_ID] },
    })
    expect(await db.evaluation.count({ where: { assignedUserId: { not: null } } })).toBe(0)
  })

  it('un criterio enviado a revisión o aprobado no cambia de responsable: 409 y no se cambia NINGUNO (todo o nada)', async () => {
    const free = await evaluationOf('Políticas')
    const sent = await evaluationOf('Roles')
    const approved = await evaluationOf('Contratos')
    await db.evaluation.update({ where: { id: sent }, data: { status: 'COMPLETED', assignedUserId: ana } })
    await db.evaluation.update({ where: { id: approved }, data: { status: 'APPROVED', assignedUserId: ana } })
    const res = await assign([free, sent, approved], luis)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EVALUATION_NOT_REASSIGNABLE')
    expect(res.body.error.details.evaluationIds.sort()).toEqual([sent, approved].sort())
    expect((await db.evaluation.findUniqueOrThrow({ where: { id: free } })).assignedUserId).toBeNull()
    // pero sí se puede "asignar" a quien ya lo tiene (no cambia nada) y se reasigna lo que está en curso o devuelto
    await db.evaluation.update({ where: { id: sent }, data: { status: 'RETURNED' } })
    expect((await assign([sent], luis)).status).toBe(200)
  })

  it('solo el LÍDER: ni el manager, ni otro GERENTE, ni el ADMIN, ni un auditor del equipo (403)', async () => {
    const id = await evaluationOf('Roles')
    const asManager = await assign([id], ana, 'manager', 'manager')
    expect(asManager.status).toBe(403)
    expect(asManager.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'LEAD' } })
    expect((await assign([id], ana, 'manager', 'otro')).status).toBe(403)
    expect((await assign([id], ana, 'admin', 'admin')).status).toBe(403) // sin permiso global de actualizar
    expect((await assign([id], ana, 'auditor', 'ana')).status).toBe(403) // un auditor del equipo no reparte
    expect(await db.evaluation.count({ where: { assignedUserId: { not: null } } })).toBe(0)
  })

  it('un manager que se designa líder sí reparte (equipos pequeños)', async () => {
    const id = await evaluationOf('Roles')
    const manager = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    await db.auditMember.update({ where: { auditId_userId: { auditId, userId: lead } }, data: { role: 'MEMBER' } })
    await db.auditMember.create({ data: { auditId, userId: manager.id, role: 'LEAD' } })
    expect((await assign([id], ana, 'manager', 'manager')).status).toBe(200)
  })

  it('en borrador y en curso sí; cerrada o archivada: 409 AUDIT_TEAM_LOCKED', async () => {
    const id = await evaluationOf('Roles')
    await db.audit.update({ where: { id: auditId }, data: { status: 'IN_PROGRESS' } })
    expect((await assign([id], ana)).status).toBe(200)
    for (const status of ['CLOSED', 'ARCHIVED'] as const) {
      await db.audit.update({ where: { id: auditId }, data: { status } })
      expect((await assign([id], luis)).body.error.code).toBe('AUDIT_TEAM_LOCKED')
    }
  })

  it.each([
    ['sin criterios', { evaluationIds: [], userId: null }],
    ['un id que no es uuid', { evaluationIds: ['x'], userId: null }],
    ['sin userId (debe ser un uuid o null)', { evaluationIds: [UNKNOWN_ID] }],
    ['demasiados', { evaluationIds: Array.from({ length: 1001 }, () => UNKNOWN_ID), userId: null }],
  ])('%s: 400', async (_caso, body) => {
    expect(
      (
        await api()
          .put(`${A}/${auditId}/assignments`)
          .set('authorization', await as('auditor', 'lider'))
          .send(body)
      ).status,
    ).toBe(400)
  })

  it('ids repetidos cuentan una vez; auditoría inexistente 404', async () => {
    const id = await evaluationOf('Roles')
    expect((await assign([id, id, id], ana)).body.data).toHaveLength(1)
    expect((await events()).length).toBe(1)
    const res = await api()
      .put(`${A}/${UNKNOWN_ID}/assignments`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: [id], userId: ana })
    expect(res.status).toBe(404)
  })

  it('el conteo del equipo refleja lo asignado', async () => {
    await assign([await evaluationOf('Roles'), await evaluationOf('Contratos')], ana)
    const team = (
      await api()
        .get(`${A}/${auditId}/members`)
        .set('authorization', await as('manager'))
    ).body.data as Array<{ user: { name: string }; assignedCount: number }>
    expect(Object.fromEntries(team.map((m) => [m.user.name, m.assignedCount]))).toEqual({ lider: 0, ana: 2, luis: 0 })
  })

  it('atomicidad: si falla el historial, no queda ninguna asignación', async () => {
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_event() RETURNS trigger AS $$
      BEGIN IF NEW."type" = 'EvaluationAssigned' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_event BEFORE INSERT ON "audit_events" FOR EACH ROW EXECUTE FUNCTION test_fail_event()`,
    )
    try {
      const res = await assign([await evaluationOf('Roles')], ana)
      expect(res.status).toBe(500)
      expect(await db.evaluation.count({ where: { assignedUserId: { not: null } } })).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_fail_event ON "audit_events"')
      await db.$executeRawUnsafe('DROP FUNCTION test_fail_event()')
    }
  })

  it('una auditoría grande (600 criterios) se reparte en una operación', async () => {
    const big = await db.template.create({ data: { name: 'Grande', status: 'PUBLISHED' } })
    const domains = Array.from({ length: 6 }, (_v, d) => ({
      title: `D${d}`,
      kids: Array.from({ length: 100 }, (_w, k) => ({ title: `D${d}.C${k}` })),
    }))
    const { seedControls } = await import('./support/templates.js')
    await seedControls(db, big.id, domains)
    const bigAudit = (
      await api()
        .post(A)
        .set('authorization', await as('manager'))
        .send({ ...auditBody(lib), templateId: big.id, name: 'Grande' })
    ).body.data.id
    await db.auditMember.createMany({
      data: [
        { auditId: bigAudit, userId: ana, role: 'MEMBER' },
        { auditId: bigAudit, userId: lead, role: 'LEAD' },
      ],
    })
    const ids = (await db.evaluation.findMany({ where: { auditId: bigAudit }, select: { id: true } })).map((e) => e.id)
    expect(ids).toHaveLength(600)
    const res = await api()
      .put(`${A}/${bigAudit}/assignments`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: ids, userId: ana })
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(600)
    expect(await db.evaluation.count({ where: { auditId: bigAudit, assignedUserId: ana } })).toBe(600)
  })
})
