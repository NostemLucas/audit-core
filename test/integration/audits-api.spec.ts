import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { listRoutes } from '../../src/platform/authz/index.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { auditBody, LEAF_TITLES, type LibraryFixture, libraryFixture } from './support/audits.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

let lib: LibraryFixture
beforeEach(async () => {
  lib = await libraryFixture(db)
})

async function create(body: Record<string, unknown> = auditBody(lib), role: TestRole = 'manager', who?: string) {
  return api()
    .post(A)
    .set('authorization', await as(role, who))
    .send(body)
}
const get = async (id: string, role: TestRole = 'manager', who?: string) =>
  api()
    .get(`${A}/${id}`)
    .set('authorization', await as(role, who))
const idOf = async (body?: Record<string, unknown>, role: TestRole = 'manager', who?: string): Promise<string> =>
  (await create(body, role, who)).body.data.id
const events = (auditId: string) => db.auditEvent.findMany({ where: { auditId }, orderBy: { createdAt: 'asc' } })

describe('permisos y rutas', () => {
  it('sin token 401; un auditor no crea, edita ni borra (403 desde el permiso global)', async () => {
    await api().get(A).expect(401)
    const id = await idOf()
    const auth = await as('auditor')
    expect((await api().post(A).set('authorization', auth).send(auditBody(lib))).status).toBe(403)
    expect((await api().patch(`${A}/${id}`).set('authorization', auth).send({ name: 'x' })).status).toBe(403)
    expect((await api().delete(`${A}/${id}`).set('authorization', auth)).status).toBe(403)
    expect((await api().post(`${A}/${id}/scope-items`).set('authorization', auth).send({ name: 'x' })).status).toBe(403)
    expect(await db.audit.count()).toBe(1)
  })

  it('cada endpoint declara la acción que le corresponde', () => {
    const declared = listRoutes(t.app().get(DiscoveryService), t.app().get(MetadataScanner), t.app().get(Reflector))
      .filter((r) =>
        ['AuditsController.', 'ScopeController.', 'TeamController.', 'EvaluationsController.'].some((c) =>
          r.handler.startsWith(c),
        ),
      )
      .map(
        (r) =>
          `${r.method} ${r.path} → ${r.access?.kind === 'can' ? `${r.access.action} ${r.access.subject}` : r.access?.kind}`,
      )
      .sort()
    expect(declared).toEqual(
      [
        'GET /audits → read Audit',
        'GET /audits/:id → read Audit',
        'POST /audits → create Audit',
        'PATCH /audits/:id → update Audit',
        'DELETE /audits/:id → delete Audit',
        'POST /audits/:auditId/scope-items → update Audit',
        'DELETE /audits/:auditId/scope-items/:itemId → update Audit',
        'POST /audits/:id/transfer → read Audit',
        'POST /audits/:id/start → update Audit',
        'POST /audits/:id/close → update Audit',
        'POST /audits/:id/archive → update Audit',
        'PUT /audits/:auditId/expected-levels → update Evaluation',
        'GET /audits/:auditId/evaluations/:evaluationId → read Evaluation',
        'PATCH /audits/:auditId/evaluations/:evaluationId → update Evaluation',
        'POST /audits/:auditId/evaluations/:evaluationId/complete → update Evaluation',
        'POST /audits/:auditId/evaluations/:evaluationId/approve → update Evaluation',
        'POST /audits/:auditId/evaluations/:evaluationId/return → update Evaluation',
        'POST /audits/:auditId/evaluations/:evaluationId/reopen → update Evaluation',
        'GET /audits/:auditId/members → read AuditMember',
        'POST /audits/:auditId/members → create AuditMember',
        'PATCH /audits/:auditId/members/:memberId → update AuditMember',
        'DELETE /audits/:auditId/members/:memberId → delete AuditMember',
        'GET /audits/:auditId/evaluations → read Evaluation',
        'PUT /audits/:auditId/assignments → update Evaluation',
      ].sort(),
    )
  })
})

describe('crear', () => {
  it('201: borrador con quien la crea como manager, código correlativo y una evaluación por hoja', async () => {
    const res = await create(
      auditBody(lib, {
        introduction: '  Intro  ',
        objectives: '',
        plannedStart: '2026-10-01',
        plannedEnd: '2026-12-31',
        scopeItems: ['ERP', 'Sede Sur'],
      }),
    )
    expect(res.status).toBe(201)
    const audit = res.body.data
    const year = new Date().getUTCFullYear()
    expect(audit).toMatchObject({
      code: `AUD-${year}-00001`,
      name: 'Auditoría ISO 27001',
      status: 'DRAFT',
      introduction: 'Intro',
      objectives: null,
      plannedStart: '2026-10-01',
      plannedEnd: '2026-12-31',
      closedAt: null,
      previousAudit: null,
      evaluationCount: 4,
      allowedActions: ['START'],
      permissions: { manage: true, lead: false, transfer: false },
      organization: { id: lib.organization.id, name: 'ACME' },
      template: { id: lib.template.id },
      scale: { id: lib.scale.id, dimension: 'CONFORMITY' },
      manager: { name: 'manager' },
    })
    expect(audit.scopeItems.map((s: { name: string }) => s.name)).toEqual(['ERP', 'Sede Sur'])
    const manager = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(audit.manager.id).toBe(manager.id)

    const rows = await db.evaluation.findMany({ where: { auditId: audit.id }, include: { control: true } })
    expect(rows.map((r) => r.control.title).sort()).toEqual([...LEAF_TITLES].sort())
    // la escala de la fixture es CONFORMITY: el nivel esperado se fija solo, al puntaje más alto (docs/06 §2)
    expect(
      rows.every((r) => r.status === 'NOT_STARTED' && r.expectedLevelId !== null && r.assignedUserId === null),
    ).toBe(true)
    expect((await db.audit.findUniqueOrThrow({ where: { id: audit.id } })).createdById).toBe(manager.id)
  })

  it('el ADMIN solo NO crea (administra la plataforma, no dirige auditorías); con también el rol GERENTE sí, como manager', async () => {
    const denied = await create(auditBody(lib), 'admin')
    expect(denied.status).toBe(403)
    expect(await db.audit.count()).toBe(0)
    const both = await create(auditBody(lib), 'adminManager')
    expect(both.status).toBe(201)
    expect(both.body.data.manager.name).toBe('adminManager')
  })

  it('deja constancia en el historial: AuditCreated con el actor, sobre la auditoría, y su texto se genera al leer', async () => {
    const id = await idOf()
    const [event] = await events(id)
    const manager = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(event).toMatchObject({
      type: 'AuditCreated',
      actorId: manager.id,
      subjectType: 'Audit',
      subjectId: id,
      targetUserId: null,
    })
    expect(renderEventMessage(event!.type, event!.payload)).toMatch(
      /^Creó la auditoría AUD-\d{4}-00001 — Auditoría ISO 27001$/,
    )
  })

  it.each([
    ['sin nombre', { name: '' }],
    ['sin plantilla', { templateId: undefined }],
    ['plantilla que no es uuid', { templateId: 'x' }],
    ['fecha con otro formato', { plannedStart: '01/10/2026' }],
    ['fecha inexistente', { plannedStart: '2026-02-31' }],
    ['alcance repetido', { scopeItems: ['ERP', 'ERP'] }],
    ['demasiados elementos de alcance', { scopeItems: Array.from({ length: 101 }, (_v, i) => `s${i}`) }],
    ['elemento de alcance vacío', { scopeItems: [' '] }],
  ])('%s: 400 y no se crea nada', async (_caso, extra) => {
    const res = await create({ ...auditBody(lib), ...extra })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(await db.audit.count()).toBe(0)
  })

  it('una plantilla que no está publicada: 409 TEMPLATE_NOT_PUBLISHED (borrador y archivada)', async () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      await db.template.update({ where: { id: lib.template.id }, data: { status } })
      const res = await create()
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('TEMPLATE_NOT_PUBLISHED')
    }
    expect(await db.audit.count()).toBe(0)
  })

  it('escala u organización desactivadas: 422; inexistentes: 404 con el código de cada una', async () => {
    await db.scale.update({ where: { id: lib.scale.id }, data: { isActive: false } })
    expect((await create()).body.error.code).toBe('SCALE_INACTIVE')
    await db.scale.update({ where: { id: lib.scale.id }, data: { isActive: true } })
    await db.organization.update({ where: { id: lib.organization.id }, data: { isActive: false } })
    expect((await create()).body.error.code).toBe('ORGANIZATION_INACTIVE')
    await db.organization.update({ where: { id: lib.organization.id }, data: { isActive: true } })

    expect((await create(auditBody(lib, { templateId: UNKNOWN_ID }))).body.error.code).toBe('TEMPLATE_NOT_FOUND')
    expect((await create(auditBody(lib, { scaleId: UNKNOWN_ID }))).body.error.code).toBe('SCALE_NOT_FOUND')
    expect((await create(auditBody(lib, { organizationId: UNKNOWN_ID }))).body.error.code).toBe(
      'ORGANIZATION_NOT_FOUND',
    )
    expect(await db.audit.count()).toBe(0)
  })

  it('fecha de fin anterior a la de inicio: 422 AUDIT_DATES_INVALID', async () => {
    const res = await create(auditBody(lib, { plannedStart: '2026-12-31', plannedEnd: '2026-10-01' }))
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('AUDIT_DATES_INVALID')
    expect((await create(auditBody(lib, { plannedStart: '2026-10-01', plannedEnd: '2026-10-01' }))).status).toBe(201)
  })

  it('los códigos son correlativos y ocho altas simultáneas nunca comparten código', async () => {
    const first = await create()
    const second = await create()
    expect([first.body.data.code, second.body.data.code].map((c: string) => c.slice(-5))).toEqual(['00001', '00002'])
    const many = await Promise.all(Array.from({ length: 8 }, () => create()))
    expect(many.map((r) => r.status)).toEqual(Array(8).fill(201))
    const codes = [first, second, ...many].map((r) => r.body.data.code)
    expect(new Set(codes).size).toBe(10)
  })

  it('atomicidad: si falla el historial, no queda la auditoría ni sus evaluaciones', async () => {
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_event() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fallo simulado'; END $$ LANGUAGE plpgsql`)
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_event BEFORE INSERT ON "audit_events" FOR EACH ROW EXECUTE FUNCTION test_fail_event()`,
    )
    try {
      const res = await create()
      expect(res.status).toBe(500)
      expect(await db.audit.count()).toBe(0)
      expect(await db.evaluation.count()).toBe(0)
      expect(await db.auditScopeItem.count()).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_fail_event ON "audit_events"')
      await db.$executeRawUnsafe('DROP FUNCTION test_fail_event()')
    }
  })
})

describe('ver', () => {
  it('el manager ve el detalle y el ADMIN también, pero solo lo VE; el alcance sale en el orden en que se agregó', async () => {
    const id = await idOf(auditBody(lib, { scopeItems: ['Zeta', 'Alfa'] }))
    const mine = await get(id)
    expect(mine.status).toBe(200)
    expect(mine.body.data.scopeItems.map((s: { name: string }) => s.name)).toEqual(['Zeta', 'Alfa'])
    expect(mine.body.data.permissions).toEqual({ manage: true, lead: false, transfer: false })
    const admin = await get(id, 'admin')
    expect(admin.status).toBe(200)
    expect(admin.body.data.permissions).toEqual({ manage: false, lead: false, transfer: true })
    expect(admin.body.data.allowedActions).toEqual([])
  })

  it('otro GERENTE puede VERLA pero no gestionarla: permisos y acciones lo reflejan', async () => {
    const id = await idOf()
    const res = await get(id, 'manager', 'otro')
    expect(res.status).toBe(200)
    expect(res.body.data.permissions).toEqual({ manage: false, lead: false, transfer: false })
    expect(res.body.data.allowedActions).toEqual([])
  })

  it('un auditor que no es miembro: 403 AUDIT_ACCESS_DENIED; siéndolo, la ve', async () => {
    const id = await idOf()
    const denied = await get(id, 'auditor')
    expect(denied.status).toBe(403)
    expect(denied.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'MEMBER' } })
    await db.auditMember.create({ data: { auditId: id, userId: await t.userId('auditor'), role: 'MEMBER' } })
    const ok = await get(id, 'auditor')
    expect(ok.status).toBe(200)
    expect(ok.body.data.permissions).toEqual({ manage: false, lead: false, transfer: false })
    expect(ok.body.data.allowedActions).toEqual([])
  })

  it('el líder ve permissions.lead = true', async () => {
    const id = await idOf()
    await db.auditMember.create({ data: { auditId: id, userId: await t.userId('auditor'), role: 'LEAD' } })
    expect((await get(id, 'auditor')).body.data.permissions).toEqual({ manage: false, lead: true, transfer: false })
  })

  it('inexistente 404; id mal formado 400', async () => {
    expect((await get(UNKNOWN_ID)).body.error.code).toBe('AUDIT_NOT_FOUND')
    expect((await get('x')).status).toBe(400)
  })
})

describe('listar', () => {
  it('un GERENTE o ADMIN ve todas; un auditor solo donde es miembro; orden: la más nueva primero; con meta de paginación', async () => {
    const a = await idOf(auditBody(lib, { name: 'Primera' }))
    const b = await idOf(auditBody(lib, { name: 'Segunda' }), 'manager', 'otro')
    const c = await idOf(auditBody(lib, { name: 'Tercera' }), 'adminManager')
    const names = async (role: TestRole, who?: string, query: Record<string, unknown> = {}) =>
      (
        await api()
          .get(A)
          .query(query)
          .set('authorization', await as(role, who))
      ).body

    expect((await names('manager')).data.map((x: { name: string }) => x.name)).toEqual([
      'Tercera',
      'Segunda',
      'Primera',
    ])
    expect((await names('admin')).meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 })
    expect((await names('auditor')).data).toEqual([])

    await db.auditMember.create({ data: { auditId: b, userId: await t.userId('auditor'), role: 'MEMBER' } })
    expect((await names('auditor')).data.map((x: { name: string }) => x.name)).toEqual(['Segunda'])
    expect(a && c).toBeTruthy()
  })

  it('mine=true deja al GERENTE solo con las que dirige o donde es miembro', async () => {
    await idOf(auditBody(lib, { name: 'Mía' }))
    await idOf(auditBody(lib, { name: 'De otro' }), 'manager', 'otro')
    const res = await api()
      .get(A)
      .query({ mine: 'true' })
      .set('authorization', await as('manager'))
    expect(res.body.data.map((x: { name: string }) => x.name)).toEqual(['Mía'])
    expect(res.body.meta.total).toBe(1)
  })

  it('filtra por estado, por organización y por texto (nombre o código, sin distinguir mayúsculas); pagina', async () => {
    const other = await libraryFixture(db, '-2')
    const one = await idOf(auditBody(lib, { name: 'Auditoría de Backups' }))
    await idOf(auditBody(other, { name: 'Revisión de accesos' }))
    await db.audit.update({ where: { id: one }, data: { status: 'IN_PROGRESS' } })
    const q = async (query: Record<string, unknown>) =>
      (
        await api()
          .get(A)
          .query(query)
          .set('authorization', await as('manager'))
      ).body

    expect((await q({ status: 'IN_PROGRESS' })).data.map((x: { name: string }) => x.name)).toEqual([
      'Auditoría de Backups',
    ])
    expect((await q({ organizationId: other.organization.id })).data.map((x: { name: string }) => x.name)).toEqual([
      'Revisión de accesos',
    ])
    expect((await q({ q: 'BACKUPS' })).data).toHaveLength(1)
    expect((await q({ q: 'AUD-' })).data).toHaveLength(2) // el código también
    const first = await q({ pageSize: 1 })
    expect(first.data).toHaveLength(1)
    expect(first.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 })
    expect((await q({ pageSize: 1, page: 2 })).data[0].name).toBe('Auditoría de Backups')
  })

  it.each([
    ['page=0', { page: 0 }],
    ['pageSize=101', { pageSize: 101 }],
    ['status desconocido', { status: 'X' }],
    ['organizationId inválido', { organizationId: 'x' }],
  ])('parámetro inválido (%s): 400', async (_caso, query) => {
    expect(
      (
        await api()
          .get(A)
          .query(query)
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(400)
  })

  it('cada fila trae sus permisos según quién pregunta', async () => {
    const id = await idOf()
    await db.auditMember.create({ data: { auditId: id, userId: await t.userId('auditor'), role: 'LEAD' } })
    const asLead = (
      await api()
        .get(A)
        .set('authorization', await as('auditor'))
    ).body.data[0]
    expect(asLead.permissions).toEqual({ manage: false, lead: true, transfer: false })
    const asOwner = (
      await api()
        .get(A)
        .set('authorization', await as('manager'))
    ).body.data[0]
    expect(asOwner.permissions).toEqual({ manage: true, lead: false, transfer: false })
  })
})

describe('editar', () => {
  const patch = async (id: string, body: Record<string, unknown>, role: TestRole = 'manager', who?: string) =>
    api()
      .patch(`${A}/${id}`)
      .set('authorization', await as(role, who))
      .send(body)

  it('cambia datos, deja la plantilla/organización/escala intactas aunque se envíen, y registra SOLO lo que cambió', async () => {
    const id = await idOf(auditBody(lib, { plannedStart: '2026-10-01', introduction: 'vieja' }))
    const other = await libraryFixture(db, '-2')
    const res = await patch(id, {
      name: 'Nuevo nombre',
      introduction: 'vieja',
      objectives: 'Objetivos',
      plannedEnd: '2026-12-31',
      templateId: other.template.id,
      organizationId: other.organization.id,
      scaleId: other.scale.id,
    })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      name: 'Nuevo nombre',
      objectives: 'Objetivos',
      plannedEnd: '2026-12-31',
      template: { id: lib.template.id },
      organization: { id: lib.organization.id },
      scale: { id: lib.scale.id },
    })
    const updated = (await events(id)).filter((e) => e.type === 'AuditUpdated')
    expect(updated).toHaveLength(1)
    expect((updated[0]!.payload as { changed: string[] }).changed.sort()).toEqual(['name', 'objectives', 'plannedEnd'])
    expect(renderEventMessage('AuditUpdated', updated[0]!.payload)).toMatch(/^Modificó /)
  })

  it('null o vacío borran un texto o una fecha; si nada cambia, no escribe ni deja rastro', async () => {
    const id = await idOf(auditBody(lib, { objectives: 'algo', plannedStart: '2026-10-01' }))
    expect((await patch(id, { objectives: '', plannedStart: null })).body.data).toMatchObject({
      objectives: null,
      plannedStart: null,
    })
    const before = (await events(id)).length
    const same = await patch(id, { name: 'Auditoría ISO 27001', objectives: null })
    expect(same.status).toBe(200)
    expect((await events(id)).length).toBe(before)
  })

  it('las fechas se validan contra las que ya tiene: solo el fin, anterior al inicio existente, es 422', async () => {
    const id = await idOf(auditBody(lib, { plannedStart: '2026-10-15' }))
    const res = await patch(id, { plannedEnd: '2026-10-01' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('AUDIT_DATES_INVALID')
    expect((await patch(id, { plannedEnd: '2026-10-20' })).status).toBe(200)
  })

  it('solo el manager: otro GERENTE 403, el ADMIN 403 (no es superusuario) y el líder 403', async () => {
    const id = await idOf()
    const denied = await patch(id, { name: 'x' }, 'manager', 'otro')
    expect(denied.status).toBe(403)
    expect(denied.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'MANAGER' } })
    expect((await patch(id, { name: 'x' }, 'admin')).status).toBe(403)
    await db.auditMember.create({ data: { auditId: id, userId: await t.userId('auditor'), role: 'LEAD' } })
    expect((await patch(id, { name: 'x' }, 'auditor')).status).toBe(403)
    expect((await db.audit.findUniqueOrThrow({ where: { id } })).name).toBe('Auditoría ISO 27001')
  })

  it('quien tiene ADMIN y GERENTE edita las que DIRIGE, no las de otro manager', async () => {
    const mine = await idOf(auditBody(lib), 'adminManager')
    const theirs = await idOf()
    expect((await patch(mine, { name: 'mía' }, 'adminManager')).status).toBe(200)
    expect((await patch(theirs, { name: 'ajena' }, 'adminManager')).status).toBe(403)
  })

  it('solo en borrador: en curso, cerrada o archivada es 409 AUDIT_NOT_EDITABLE', async () => {
    const id = await idOf()
    for (const status of ['IN_PROGRESS', 'CLOSED', 'ARCHIVED'] as const) {
      await db.audit.update({ where: { id }, data: { status } })
      const res = await patch(id, { name: 'x' })
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('AUDIT_NOT_EDITABLE')
    }
  })

  it('cuerpo vacío o inválido: 400; inexistente: 404', async () => {
    const id = await idOf()
    expect((await patch(id, {})).status).toBe(400)
    expect((await patch(id, { name: '  ' })).status).toBe(400)
    expect((await patch(id, { plannedStart: 'mañana' })).status).toBe(400)
    expect((await patch(UNKNOWN_ID, { name: 'x' })).body.error.code).toBe('AUDIT_NOT_FOUND')
  })
})

describe('eliminar', () => {
  const remove = async (id: string, role: TestRole = 'manager', who?: string) =>
    api()
      .delete(`${A}/${id}`)
      .set('authorization', await as(role, who))

  it('un borrador se elimina con sus evaluaciones, alcance e historial', async () => {
    const id = await idOf(auditBody(lib, { scopeItems: ['ERP'] }))
    expect((await remove(id)).status).toBe(204)
    expect(await db.audit.count()).toBe(0)
    expect(await db.evaluation.count()).toBe(0)
    expect(await db.auditScopeItem.count()).toBe(0)
    expect(await db.auditEvent.count()).toBe(0)
    expect((await remove(id)).status).toBe(404)
  })

  it('solo el manager (ni otro GERENTE ni el ADMIN); y solo en borrador', async () => {
    const id = await idOf()
    expect((await remove(id, 'manager', 'otro')).status).toBe(403)
    expect((await remove(id, 'admin')).status).toBe(403)
    await db.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } })
    const res = await remove(id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AUDIT_NOT_EDITABLE')
    expect(await db.audit.count()).toBe(1)
    await db.audit.update({ where: { id }, data: { status: 'DRAFT' } })
    expect((await remove(id)).status).toBe(204)
  })
})

describe('alcance', () => {
  const scopeUrl = (id: string) => `${A}/${id}/scope-items`
  const addScope = async (id: string, name: unknown, role: TestRole = 'manager', who?: string) =>
    api()
      .post(scopeUrl(id))
      .set('authorization', await as(role, who))
      .send({ name })
  const removeScope = async (id: string, itemId: string, role: TestRole = 'manager', who?: string) =>
    api()
      .delete(`${scopeUrl(id)}/${itemId}`)
      .set('authorization', await as(role, who))

  it('agregar y quitar devuelven la lista completa y dejan constancia sobre el elemento', async () => {
    const id = await idOf()
    const one = await addScope(id, '  ERP  ')
    expect(one.status).toBe(201)
    expect(one.body.data.map((s: { name: string }) => s.name)).toEqual(['ERP'])
    const two = await addScope(id, 'Sede Sur')
    expect(two.body.data.map((s: { name: string }) => s.name)).toEqual(['ERP', 'Sede Sur'])

    const erp = two.body.data[0]
    const left = await removeScope(id, erp.id)
    expect(left.status).toBe(200)
    expect(left.body.data.map((s: { name: string }) => s.name)).toEqual(['Sede Sur'])

    const history = (await events(id)).filter((e) => e.type.startsWith('ScopeItem'))
    expect(history.map((e) => [e.type, e.subjectType, e.subjectId === erp.id || e.subjectId !== null])).toEqual([
      ['ScopeItemAdded', 'ScopeItem', true],
      ['ScopeItemAdded', 'ScopeItem', true],
      ['ScopeItemRemoved', 'ScopeItem', true],
    ])
    expect(renderEventMessage(history[2]!.type, history[2]!.payload)).toBe('Quitó "ERP" del alcance')
  })

  it('un nombre repetido: 409 AUDIT_SCOPE_ITEM_NAME_TAKEN y sin rastro en el historial', async () => {
    const id = await idOf(auditBody(lib, { scopeItems: ['ERP'] }))
    const res = await addScope(id, 'ERP')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AUDIT_SCOPE_ITEM_NAME_TAKEN')
    expect((await events(id)).filter((e) => e.type === 'ScopeItemAdded')).toHaveLength(0)
    expect(await db.auditScopeItem.count()).toBe(1)
  })

  it('validación: vacío o demasiado largo 400; quitar uno inexistente o de otra auditoría 404', async () => {
    const id = await idOf()
    const other = await idOf(auditBody(lib, { scopeItems: ['ajeno'] }))
    const foreign = await db.auditScopeItem.findFirstOrThrow({ where: { auditId: other } })
    expect((await addScope(id, '  ')).status).toBe(400)
    expect((await addScope(id, 'x'.repeat(201))).status).toBe(400)
    expect((await removeScope(id, UNKNOWN_ID)).body.error.code).toBe('AUDIT_SCOPE_ITEM_NOT_FOUND')
    expect((await removeScope(id, foreign.id)).body.error.code).toBe('AUDIT_SCOPE_ITEM_NOT_FOUND')
    expect(await db.auditScopeItem.count()).toBe(1)
  })

  it('solo el manager (ni otro GERENTE ni el ADMIN) y solo en borrador; auditoría inexistente 404', async () => {
    const id = await idOf(auditBody(lib, { scopeItems: ['ERP'] }))
    const item = await db.auditScopeItem.findFirstOrThrow({ where: { auditId: id } })
    expect((await addScope(id, 'x', 'manager', 'otro')).status).toBe(403)
    expect((await addScope(id, 'x', 'admin')).status).toBe(403)
    expect((await removeScope(id, item.id, 'manager', 'otro')).status).toBe(403)
    expect((await addScope(UNKNOWN_ID, 'x')).body.error.code).toBe('AUDIT_NOT_FOUND')
    await db.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } })
    expect((await addScope(id, 'x')).body.error.code).toBe('AUDIT_NOT_EDITABLE')
    expect((await removeScope(id, item.id)).body.error.code).toBe('AUDIT_NOT_EDITABLE')
    expect(await db.auditScopeItem.count()).toBe(1)
  })
})
