import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { auditBody, type LibraryFixture, libraryFixture } from './support/audits.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db, storage } = t

let lib: LibraryFixture
beforeEach(async () => {
  lib = await libraryFixture(db)
})

async function newAudit(who = 'manager', body: Record<string, unknown> = auditBody(lib)) {
  const res = await api()
    .post(A)
    .set('authorization', await as('manager', who))
    .send(body)
  return res.body.data.id as string
}
const members = (id: string) => `${A}/${id}/members`
const add = async (
  auditId: string,
  userId: string,
  role: 'LEAD' | 'MEMBER',
  role$: TestRole = 'manager',
  who = 'manager',
) =>
  api()
    .post(members(auditId))
    .set('authorization', await as(role$, who))
    .send({ userId, role })
const events = (auditId: string) => db.auditEvent.findMany({ where: { auditId }, orderBy: { createdAt: 'asc' } })
const teamOf = async (auditId: string) =>
  (
    await api()
      .get(members(auditId))
      .set('authorization', await as('manager'))
  ).body.data as Array<{ id: string; role: string; user: { name: string }; assignedCount: number }>

/** Usuarios de prueba: dos auditores, un gerente y un usuario sin rol. */
async function people() {
  return {
    ana: await t.userId('auditor', 'ana'),
    luis: await t.userId('auditor', 'luis'),
    eva: await t.userId('manager', 'eva'), // GERENTE: puede ser miembro
    nadie: await (async () => {
      const token = await as('auditor', 'nadie')
      await api().get('/api/v1/profile').set('authorization', token)
      const user = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-nadie' } })
      await db.user.update({ where: { id: user.id }, data: { roles: [] } }) // sin roles: no puede ser miembro
      return user.id
    })(),
  }
}

describe('armar el equipo (solo el manager)', () => {
  it('agrega un líder y auditores; devuelve el equipo con el líder primero y cuántos criterios tiene cada uno', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    expect((await add(id, luis, 'MEMBER')).status).toBe(201)
    const res = await add(id, ana, 'LEAD')
    expect(res.status).toBe(201)
    expect(res.body.data.map((m: { role: string; user: { name: string } }) => [m.role, m.user.name])).toEqual([
      ['LEAD', 'ana'],
      ['MEMBER', 'luis'],
    ])
    expect(res.body.data.every((m: { assignedCount: number }) => m.assignedCount === 0)).toBe(true)
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['assignedCount', 'createdAt', 'id', 'role', 'user'])
  })

  it('puede ser miembro un usuario AUDITOR o GERENTE (un gerente puede ser líder); sin rol global, no: 422', async () => {
    const id = await newAudit()
    const { eva, nadie } = await people()
    expect((await add(id, eva, 'LEAD')).status).toBe(201)
    const denied = await add(id, nadie, 'MEMBER')
    expect(denied.status).toBe(422)
    expect(denied.body.error.code).toBe('MEMBER_USER_INELIGIBLE')
    expect((await teamOf(id)).map((m) => m.user.name)).toEqual(['eva'])
  })

  it('el manager puede designarse a sí mismo líder (equipos pequeños)', async () => {
    const id = await newAudit()
    const manager = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect((await add(id, manager.id, 'LEAD')).status).toBe(201)
  })

  it('un miembro repetido: 409 MEMBER_ALREADY_ASSIGNED; un segundo líder: 409 AUDIT_LEAD_ALREADY_ASSIGNED', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    await add(id, ana, 'LEAD')
    const twice = await add(id, ana, 'MEMBER')
    expect(twice.status).toBe(409)
    expect(twice.body.error.code).toBe('MEMBER_ALREADY_ASSIGNED')
    const second = await add(id, luis, 'LEAD')
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('AUDIT_LEAD_ALREADY_ASSIGNED')
    expect(await db.auditMember.count()).toBe(1)
  })

  it('designaciones simultáneas de líder: exactamente una gana (sin bloqueos)', async () => {
    const id = await newAudit()
    const ids = await Promise.all(['a1', 'a2', 'a3', 'a4'].map((n) => t.userId('auditor', n)))
    const results = await Promise.all(ids.map((userId) => add(id, userId, 'LEAD')))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
    expect(await db.auditMember.count({ where: { role: 'LEAD' } })).toBe(1)
  })

  it.each([
    ['sin userId', { role: 'MEMBER' }],
    ['userId que no es uuid', { userId: 'x', role: 'MEMBER' }],
    ['rol inválido (el rol antiguo ya no existe)', { userId: UNKNOWN_ID, role: 'INSPECTOR' }],
  ])('%s: 400', async (_caso, body) => {
    const id = await newAudit()
    expect(
      (
        await api()
          .post(members(id))
          .set('authorization', await as('manager'))
          .send(body)
      ).status,
    ).toBe(400)
  })

  it('un usuario inexistente: 404 USER_NOT_FOUND; una auditoría inexistente: 404', async () => {
    const id = await newAudit()
    expect((await add(id, UNKNOWN_ID, 'MEMBER')).body.error.code).toBe('USER_NOT_FOUND')
    const { ana } = await people()
    expect((await add(UNKNOWN_ID, ana, 'MEMBER')).body.error.code).toBe('AUDIT_NOT_FOUND')
  })

  it('el líder NO arma el equipo, ni otro GERENTE, ni el ADMIN, ni un auditor (403); el ADMIN ni siquiera pasa el permiso global', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    await add(id, ana, 'LEAD')
    const asLead = await add(id, luis, 'MEMBER', 'auditor', 'ana')
    expect(asLead.status).toBe(403) // el líder no tiene permiso global de crear miembros
    const otherManager = await add(id, luis, 'MEMBER', 'manager', 'otro')
    expect(otherManager.status).toBe(403)
    expect(otherManager.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'MANAGER' } })
    expect((await add(id, luis, 'MEMBER', 'admin')).status).toBe(403)
    expect((await add(id, luis, 'MEMBER', 'auditor', 'luis')).status).toBe(403)
    expect(await db.auditMember.count()).toBe(1)
  })

  it('en borrador y en curso sí; cerrada o archivada: 409 AUDIT_TEAM_LOCKED', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    await db.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } })
    expect((await add(id, ana, 'MEMBER')).status).toBe(201)
    for (const status of ['CLOSED', 'ARCHIVED'] as const) {
      await db.audit.update({ where: { id }, data: { status } })
      const res = await add(id, luis, 'MEMBER')
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('AUDIT_TEAM_LOCKED')
    }
  })

  it('deja constancia en el historial con nombres y su texto en español', async () => {
    const id = await newAudit()
    const { ana } = await people()
    await add(id, ana, 'LEAD')
    const event = (await events(id)).find((e) => e.type === 'MemberAssigned')!
    const manager = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(event).toMatchObject({ actorId: manager.id, targetUserId: ana, subjectType: 'AuditMember' })
    expect(renderEventMessage(event.type, event.payload)).toBe('Agregó a ana al equipo como líder')
  })
})

describe('acceso persistente en Nextcloud (docs/07 §1.5)', () => {
  it('agregar da acceso a TODA la evidencia (solo lectura) y a los informes (editable), por username', async () => {
    const id = await newAudit()
    const { ana } = await people()
    await add(id, ana, 'LEAD')
    const code = (await db.audit.findUniqueOrThrow({ where: { id } })).code
    expect(storage.userShares.get(`/Auditorias/${code}/Evidencias\x00ana`)).toBe('READ_ONLY')
    expect(storage.userShares.get(`/Auditorias/${code}/Informes\x00ana`)).toBe('EDIT_NO_DELETE')
  })

  it('quitar del equipo revoca los dos; a otro miembro no le toca', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    await add(id, ana, 'LEAD')
    await add(id, luis, 'MEMBER')
    const code = (await db.audit.findUniqueOrThrow({ where: { id } })).code
    const member = await db.auditMember.findFirstOrThrow({ where: { userId: luis } })
    expect(
      (
        await api()
          .delete(`${members(id)}/${member.id}`)
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(200)
    expect(storage.userShares.has(`/Auditorias/${code}/Evidencias\x00luis`)).toBe(false)
    expect(storage.userShares.has(`/Auditorias/${code}/Informes\x00luis`)).toBe(false)
    // ana (líder) sigue con acceso: solo se revocó lo de luis
    expect(storage.userShares.get(`/Auditorias/${code}/Evidencias\x00ana`)).toBe('READ_ONLY')
    expect(storage.userShares.get(`/Auditorias/${code}/Informes\x00ana`)).toBe('EDIT_NO_DELETE')
  })

  it('cerrar la auditoría baja los informes del equipo a solo lectura; la evidencia no se toca (ya lo era)', async () => {
    const id = await newAudit()
    const { ana } = await people()
    await add(id, ana, 'LEAD')
    const code = (await db.audit.findUniqueOrThrow({ where: { id } })).code
    await db.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } })
    await db.evaluation.updateMany({ where: { auditId: id }, data: { status: 'APPROVED' } })

    const res = await api()
      .post(`${A}/${id}/close`)
      .set('authorization', await as('manager'))
    expect(res.status).toBe(200)
    expect(storage.userShares.get(`/Auditorias/${code}/Informes\x00ana`)).toBe('READ_ONLY')
    expect(storage.userShares.get(`/Auditorias/${code}/Evidencias\x00ana`)).toBe('READ_ONLY')
  })
})

describe('ver el equipo', () => {
  it('lo ven el manager, los miembros y el ADMIN; un auditor ajeno no (403)', async () => {
    const id = await newAudit()
    const { ana } = await people()
    await add(id, ana, 'MEMBER')
    const get = async (role: TestRole, who?: string) =>
      api()
        .get(members(id))
        .set('authorization', await as(role, who))
    expect((await get('manager')).status).toBe(200)
    expect((await get('auditor', 'ana')).status).toBe(200)
    expect((await get('admin')).status).toBe(200)
    const denied = await get('auditor', 'luis')
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('AUDIT_ACCESS_DENIED')
    expect(
      (
        await api()
          .get(members(UNKNOWN_ID))
          .set('authorization', await as('manager'))
      ).status,
    ).toBe(404)
  })
})

describe('cambiar de rol y de líder', () => {
  const patch = async (auditId: string, memberId: string, role: string, who = 'manager', role$: TestRole = 'manager') =>
    api()
      .patch(`${members(auditId)}/${memberId}`)
      .set('authorization', await as(role$, who))
      .send({ role })

  it('se cambia de líder en dos pasos: el actual pasa a auditor y el nuevo a líder; queda un solo líder', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    await add(id, ana, 'LEAD')
    await add(id, luis, 'MEMBER')
    const [lead, member] = await db.auditMember.findMany({ orderBy: { role: 'asc' } })
    // designar a luis sin quitar a ana: la BD lo impide
    const blocked = await patch(id, member!.id, 'LEAD')
    expect(blocked.body.error.code).toBe('AUDIT_LEAD_ALREADY_ASSIGNED')
    expect((await patch(id, lead!.id, 'MEMBER')).status).toBe(200)
    const swapped = await patch(id, member!.id, 'LEAD')
    expect(swapped.body.data.map((m: { role: string; user: { name: string } }) => [m.role, m.user.name])).toEqual([
      ['LEAD', 'luis'],
      ['MEMBER', 'ana'],
    ])
    const changes = (await events(id)).filter((e) => e.type === 'MemberRoleChanged')
    expect(changes.map((e) => renderEventMessage(e.type, e.payload))).toEqual([
      'Cambió a ana de líder a auditor',
      'Cambió a luis de auditor a líder',
    ])
  })

  it('quien tiene criterios asignados no puede pasar a líder (el líder revisa, no evalúa): 409', async () => {
    const id = await newAudit()
    const { ana } = await people()
    await add(id, ana, 'MEMBER')
    const member = await db.auditMember.findFirstOrThrow()
    const evaluation = await db.evaluation.findFirstOrThrow({ where: { auditId: id } })
    await db.evaluation.update({ where: { id: evaluation.id }, data: { assignedUserId: ana } })
    const res = await patch(id, member.id, 'LEAD')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'MEMBER_HAS_ASSIGNED_EVALUATIONS', details: { count: 1 } })
    expect((await db.auditMember.findUniqueOrThrow({ where: { id: member.id } })).role).toBe('MEMBER')
  })

  it('el mismo rol no hace nada ni deja rastro; miembro inexistente o de otra auditoría 404; solo el manager', async () => {
    const id = await newAudit()
    const other = await newAudit()
    const { ana, luis } = await people()
    await add(id, ana, 'MEMBER')
    await add(other, luis, 'MEMBER')
    const member = await db.auditMember.findFirstOrThrow({ where: { auditId: id } })
    const foreign = await db.auditMember.findFirstOrThrow({ where: { auditId: other } })
    const before = (await events(id)).length
    expect((await patch(id, member.id, 'MEMBER')).status).toBe(200)
    expect((await events(id)).length).toBe(before)
    expect((await patch(id, UNKNOWN_ID, 'LEAD')).body.error.code).toBe('MEMBER_NOT_FOUND')
    expect((await patch(id, foreign.id, 'LEAD')).body.error.code).toBe('MEMBER_NOT_FOUND')
    expect((await patch(id, member.id, 'LEAD', 'otro')).status).toBe(403)
    expect((await patch(id, member.id, 'X')).status).toBe(400)
  })
})

describe('quitar del equipo', () => {
  const remove = async (auditId: string, memberId: string, who = 'manager') =>
    api()
      .delete(`${members(auditId)}/${memberId}`)
      .set('authorization', await as('manager', who))

  it('quita a un miembro, devuelve el equipo y lo registra', async () => {
    const id = await newAudit()
    const { ana, luis } = await people()
    await add(id, ana, 'LEAD')
    await add(id, luis, 'MEMBER')
    const member = await db.auditMember.findFirstOrThrow({ where: { userId: luis } })
    const res = await remove(id, member.id)
    expect(res.status).toBe(200)
    expect(res.body.data.map((m: { user: { name: string } }) => m.user.name)).toEqual(['ana'])
    const event = (await events(id)).find((e) => e.type === 'MemberRemoved')!
    expect(renderEventMessage(event.type, event.payload)).toBe('Quitó a luis del equipo (auditor)')
  })

  it('con criterios asignados: 409 y no se quita; reasignados (o sin asignar), sí', async () => {
    const id = await newAudit()
    const { luis } = await people()
    await add(id, luis, 'MEMBER')
    const member = await db.auditMember.findFirstOrThrow()
    const evaluation = await db.evaluation.findFirstOrThrow({ where: { auditId: id } })
    await db.evaluation.update({ where: { id: evaluation.id }, data: { assignedUserId: luis } })
    const blocked = await remove(id, member.id)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toMatchObject({ code: 'MEMBER_HAS_ASSIGNED_EVALUATIONS', details: { count: 1 } })
    expect(await db.auditMember.count()).toBe(1)
    await db.evaluation.update({ where: { id: evaluation.id }, data: { assignedUserId: null } })
    expect((await remove(id, member.id)).status).toBe(200)
  })

  it('se puede quitar al líder (el manager designa otro); inexistente 404; solo el manager; cerrada 409', async () => {
    const id = await newAudit()
    const { ana } = await people()
    await add(id, ana, 'LEAD')
    const lead = await db.auditMember.findFirstOrThrow()
    expect((await remove(id, UNKNOWN_ID)).body.error.code).toBe('MEMBER_NOT_FOUND')
    expect((await remove(id, lead.id, 'otro')).status).toBe(403)
    await db.audit.update({ where: { id }, data: { status: 'CLOSED' } })
    expect((await remove(id, lead.id)).body.error.code).toBe('AUDIT_TEAM_LOCKED')
    await db.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } })
    expect((await remove(id, lead.id)).status).toBe(200)
  })
})

describe('transferir la auditoría (solo el ADMIN)', () => {
  const transfer = async (auditId: string, managerId: string, role: TestRole = 'admin', who?: string) =>
    api()
      .post(`${A}/${auditId}/transfer`)
      .set('authorization', await as(role, who))
      .send({ managerId })

  it('el ADMIN pasa la auditoría a otro GERENTE, en cualquier estado; el nuevo manager gestiona y el anterior deja de poder', async () => {
    const id = await newAudit()
    const eva = await t.userId('manager', 'eva')
    for (const status of ['DRAFT', 'IN_PROGRESS', 'CLOSED'] as const) {
      await db.audit.update({
        where: { id },
        data: { status, managerId: (await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })).id },
      })
      const res = await transfer(id, eva)
      expect(res.status).toBe(200)
      expect(res.body.data.manager.id).toBe(eva)
      expect(res.body.data.permissions).toEqual({ manage: false, lead: false, transfer: true }) // lo ve el ADMIN
    }
    // el nuevo manager la ve como suya y el anterior ya no la gestiona
    const asNew = await api()
      .get(`${A}/${id}`)
      .set('authorization', await as('manager', 'eva'))
    expect(asNew.body.data.permissions.manage).toBe(true)
    const asOld = await api()
      .get(`${A}/${id}`)
      .set('authorization', await as('manager'))
    expect(asOld.body.data.permissions.manage).toBe(false)
  })

  it('queda en el historial con ambos nombres; transferir al mismo manager no hace nada ni deja rastro', async () => {
    const id = await newAudit()
    const eva = await t.userId('manager', 'eva')
    const manager = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect((await transfer(id, manager.id)).status).toBe(200)
    expect((await events(id)).filter((e) => e.type === 'AuditTransferred')).toHaveLength(0)
    await transfer(id, eva)
    const event = (await events(id)).find((e) => e.type === 'AuditTransferred')!
    const admin = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-admin' } })
    expect(event).toMatchObject({ actorId: admin.id, targetUserId: eva })
    expect(renderEventMessage(event.type, event.payload)).toBe('Transfirió la auditoría de manager a eva')
  })

  it('nadie más transfiere: ni el manager, ni otro GERENTE, ni el líder, ni un auditor (403)', async () => {
    const id = await newAudit()
    const eva = await t.userId('manager', 'eva')
    const { ana } = await people()
    await add(id, ana, 'LEAD')
    const owner = await transfer(id, eva, 'manager')
    expect(owner.status).toBe(403)
    expect(owner.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'ADMIN' } })
    expect((await transfer(id, eva, 'manager', 'otro')).status).toBe(403)
    expect((await transfer(id, eva, 'auditor', 'ana')).status).toBe(403)
    expect(
      (
        await api()
          .get(`${A}/${id}`)
          .set('authorization', await as('manager'))
      ).body.data.manager.name,
    ).toBe('manager')
  })

  it('el nuevo manager debe ser GERENTE (422); usuario o auditoría inexistentes 404; sin uuid 400', async () => {
    const id = await newAudit()
    const { ana } = await people()
    const ineligible = await transfer(id, ana)
    expect(ineligible.status).toBe(422)
    expect(ineligible.body.error.code).toBe('AUDIT_MANAGER_INELIGIBLE')
    expect((await transfer(id, UNKNOWN_ID)).body.error.code).toBe('USER_NOT_FOUND')
    const eva = await t.userId('manager', 'eva')
    expect((await transfer(UNKNOWN_ID, eva)).body.error.code).toBe('AUDIT_NOT_FOUND')
    expect(
      (
        await api()
          .post(`${A}/${id}/transfer`)
          .set('authorization', await as('admin'))
          .send({ managerId: 'x' })
      ).status,
    ).toBe(400)
  })
})
