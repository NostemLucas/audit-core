import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { auditBody, libraryFixture } from './support/audits.js'
import { type StartedAudit, startedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

const levelId = (ctx: StartedAudit, label: string) => ctx.lib.scale.levels.find((l) => l.label === label)!.id
const evalOf = (auditId: string, title: string) =>
  db.evaluation.findFirstOrThrow({ where: { auditId, control: { title } } })
const get = async (path: string, role: TestRole = 'manager', who?: string) =>
  api()
    .get(path)
    .set('authorization', await as(role, who))
const post = async (path: string, body: object, role: TestRole = 'manager', who?: string) =>
  api()
    .post(path)
    .set('authorization', await as(role, who))
    .send(body)

type Result = { achieved?: string; expected?: string; na?: boolean; notes?: string; findings?: string }

/**
 * Una auditoría CERRADA con resultados reales (CONFORMITY): Políticas cumple, Roles queda por debajo, Antecedentes no aplica,
 * Contratos cumple. Alcance: ERP y CRM. Directo en la BD: aquí se prueba el seguimiento, no el flujo de cierre.
 */
async function closedAudit(
  overrides: Record<string, Result> = {},
  suffix = '',
  status: 'CLOSED' | 'ARCHIVED' = 'CLOSED',
) {
  const ctx = await startedAudit(t, 'CONFORMITY', suffix)
  const results: Record<string, Result> = {
    Políticas: { achieved: 'Cumple', notes: 'Revisado con TI' },
    Roles: { achieved: 'Parcial', findings: 'Cubre la mitad' },
    Antecedentes: { na: true },
    Contratos: { achieved: 'Cumple' },
    ...overrides,
  }
  for (const [title, r] of Object.entries(results)) {
    await db.evaluation.update({
      where: { id: (await evalOf(ctx.auditId, title)).id },
      data: {
        status: 'APPROVED',
        ...(r.achieved && { achievedLevelId: levelId(ctx, r.achieved) }),
        ...(r.expected && { expectedLevelId: levelId(ctx, r.expected) }),
        ...(r.na && { isNotApplicable: true, notApplicableReason: 'No hay contratos' }),
        ...(r.notes && { notes: r.notes }),
        ...(r.findings && { findings: r.findings }),
      },
    })
  }
  await db.auditScopeItem.createMany({
    data: [
      { auditId: ctx.auditId, name: 'ERP' },
      { auditId: ctx.auditId, name: 'CRM' },
    ],
  })
  await db.audit.update({ where: { id: ctx.auditId }, data: { status, closedAt: new Date() } })
  return ctx
}

const followUp = (
  previous: StartedAudit,
  extra: Record<string, unknown> = {},
  role: TestRole = 'manager',
  who?: string,
) => post(A, { name: 'Seguimiento 2027', previousAuditId: previous.auditId, ...extra }, role, who)

describe('crear un seguimiento (docs/06 §9)', () => {
  it('toma plantilla, escala y organización de la anterior, copia el alcance y traslada aprobado lo que cumplió', async () => {
    const prev = await closedAudit()
    const res = await followUp(prev)
    expect(res.status).toBe(201)
    const view = res.body.data
    expect(view).toMatchObject({
      status: 'DRAFT',
      previousAudit: { id: prev.auditId, name: 'Auditoría ISO 27001' },
      template: { id: prev.lib.template.id },
      scale: { id: prev.lib.scale.id },
      organization: { id: prev.lib.organization.id },
      evaluationCount: 4,
      scopeItems: [{ name: 'ERP' }, { name: 'CRM' }],
    })

    const carried = await Promise.all(['Políticas', 'Antecedentes', 'Contratos'].map((title) => evalOf(view.id, title)))
    for (const row of carried) {
      expect(row).toMatchObject({ status: 'APPROVED', assignedUserId: null })
      const before = await db.evaluation.findUniqueOrThrow({ where: { id: row.carriedFromId! } })
      expect(before.auditId).toBe(prev.auditId)
      expect(before.controlId).toBe(row.controlId)
      // el resultado viaja completo
      expect(row).toMatchObject({
        achievedLevelId: before.achievedLevelId,
        notes: before.notes,
        findings: before.findings,
        isNotApplicable: before.isNotApplicable,
        notApplicableReason: before.notApplicableReason,
      })
    }
    expect((await evalOf(view.id, 'Políticas')).notes).toBe('Revisado con TI')
    expect(await evalOf(view.id, 'Antecedentes')).toMatchObject({
      isNotApplicable: true,
      notApplicableReason: 'No hay contratos',
    })

    // lo que quedó por debajo se evalúa de nuevo: limpio, sin asignar, y con lo esperado ya heredado
    expect(await evalOf(view.id, 'Roles')).toMatchObject({
      status: 'NOT_STARTED',
      carriedFromId: null,
      achievedLevelId: null,
      findings: null,
      assignedUserId: null,
      expectedLevelId: levelId(prev, 'Cumple'),
    })
  })

  it('el historial lo dice: seguimiento de qué auditoría y cuántos criterios se trasladaron', async () => {
    const prev = await closedAudit()
    const id = (await followUp(prev)).body.data.id
    const previousCode = (await db.audit.findUniqueOrThrow({ where: { id: prev.auditId } })).code
    const created = await db.auditEvent.findFirstOrThrow({ where: { auditId: id, type: 'AuditCreated' } })
    expect(renderEventMessage(created.type, created.payload)).toMatch(
      new RegExp(`seguimiento de ${previousCode} \\(3 criterios trasladados\\)`),
    )
  })

  it('con carryOver: false se evalúa todo de nuevo (nada trasladado) y el alcance es editable', async () => {
    const prev = await closedAudit()
    const res = await followUp(prev, { carryOver: false })
    expect(res.status).toBe(201)
    const rows = await db.evaluation.findMany({ where: { auditId: res.body.data.id } })
    expect(
      rows.every((r) => r.status === 'NOT_STARTED' && r.carriedFromId === null && r.achievedLevelId === null),
    ).toBe(true)
    expect(res.body.data.scopeItems).toHaveLength(2) // copiado como punto de partida…
    const added = await post(`${A}/${res.body.data.id}/scope-items`, { name: 'Sistema de pagos' })
    expect(added.status).toBe(201) // …y editable
    const replaced = await followUp(prev, { carryOver: false, scopeItems: ['Solo la sede'] })
    expect(replaced.body.data.scopeItems.map((s: { name: string }) => s.name)).toEqual(['Solo la sede'])
  })

  it('con criterios trasladados el alcance queda heredado: no se puede indicar otro ni modificar (409 AUDIT_SCOPE_INHERITED)', async () => {
    const prev = await closedAudit()
    const rejected = await followUp(prev, { scopeItems: ['Otro'] })
    expect(rejected.status).toBe(409)
    expect(rejected.body.error.code).toBe('AUDIT_SCOPE_INHERITED')
    expect(await db.audit.count({ where: { previousAuditId: prev.auditId } })).toBe(0) // todo o nada

    const id = (await followUp(prev)).body.data.id
    expect((await post(`${A}/${id}/scope-items`, { name: 'Otro' })).body.error.code).toBe('AUDIT_SCOPE_INHERITED')
    const item = await db.auditScopeItem.findFirstOrThrow({ where: { auditId: id } })
    const removed = await api()
      .delete(`${A}/${id}/scope-items/${item.id}`)
      .set('authorization', await as('manager'))
    expect(removed.body.error.code).toBe('AUDIT_SCOPE_INHERITED')
  })

  it('si no hay nada que trasladar (todo quedó por debajo), el alcance sí se puede cambiar', async () => {
    const prev = await closedAudit({
      Políticas: { achieved: 'Parcial' },
      Antecedentes: { achieved: 'No cumple' },
      Contratos: { achieved: 'Parcial' },
    })
    const res = await followUp(prev, { scopeItems: ['Otro alcance'] })
    expect(res.status).toBe(201)
    expect(res.body.data.scopeItems.map((s: { name: string }) => s.name)).toEqual(['Otro alcance'])
    expect(await db.evaluation.count({ where: { auditId: res.body.data.id, carriedFromId: { not: null } } })).toBe(0)
    expect((await post(`${A}/${res.body.data.id}/scope-items`, { name: 'Más' })).status).toBe(201)
  })

  it('en madurez cada criterio hereda su nivel esperado y su guía; el líder no parte de cero', async () => {
    const prev = await startedAudit(t, 'MATURITY', '-m')
    await db.evaluation.update({
      where: { id: (await evalOf(prev.auditId, 'Roles')).id },
      data: {
        expectedLevelId: levelId(prev, 'Cumple'),
        guidance: 'Proceso crítico',
        achievedLevelId: levelId(prev, 'Parcial'),
        status: 'APPROVED',
      },
    })
    for (const title of ['Políticas', 'Antecedentes', 'Contratos']) {
      await db.evaluation.update({
        where: { id: (await evalOf(prev.auditId, title)).id },
        data: { achievedLevelId: levelId(prev, 'Cumple'), status: 'APPROVED' },
      })
    }
    await db.audit.update({ where: { id: prev.auditId }, data: { status: 'CLOSED' } })

    const id = (await followUp(prev)).body.data.id
    expect(await evalOf(id, 'Roles')).toMatchObject({
      expectedLevelId: levelId(prev, 'Cumple'),
      guidance: 'Proceso crítico',
      status: 'NOT_STARTED', // por debajo de lo esperado: se evalúa de nuevo
    })
    expect(await evalOf(id, 'Políticas')).toMatchObject({
      expectedLevelId: levelId(prev, 'Parcial'),
      status: 'APPROVED',
    })
  })

  it('cerrada o archivada sirven de referencia; en borrador o en curso, no (409); una inexistente es 404', async () => {
    const draft = await startedAudit(t, 'CONFORMITY', '-a')
    await db.audit.update({ where: { id: draft.auditId }, data: { status: 'DRAFT' } })
    const running = await startedAudit(t, 'CONFORMITY', '-b')
    for (const prev of [draft, running]) {
      const res = await followUp(prev)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('AUDIT_CANNOT_FOLLOW_UP')
    }
    expect((await followUp(await closedAudit({}, '-c', 'ARCHIVED'))).status).toBe(201)
    expect((await post(A, { name: 'X', previousAuditId: UNKNOWN_ID })).body.error.code).toBe('AUDIT_NOT_FOUND')
  })

  it('el cuerpo: con seguimiento no se indican plantilla/escala/organización; sin él sí; carryOver solo con seguimiento (400)', async () => {
    const prev = await closedAudit()
    expect((await followUp(prev, { templateId: prev.lib.template.id })).status).toBe(400)
    expect((await followUp(prev, { organizationId: prev.lib.organization.id })).status).toBe(400)
    expect((await post(A, { name: 'X' })).status).toBe(400)
    const lib = await libraryFixture(db, '-z')
    expect((await post(A, auditBody(lib, { carryOver: true }))).status).toBe(400)
  })

  it('una plantilla archivada o una escala desactivada después NO impiden el seguimiento (es la misma medición); una organización inactiva sí (422)', async () => {
    const prev = await closedAudit()
    await db.template.update({ where: { id: prev.lib.template.id }, data: { status: 'ARCHIVED' } })
    await db.scale.update({ where: { id: prev.lib.scale.id }, data: { isActive: false } })
    expect((await followUp(prev)).status).toBe(201)
    await db.organization.update({ where: { id: prev.lib.organization.id }, data: { isActive: false } })
    const res = await followUp(prev)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('ORGANIZATION_INACTIVE')
  })

  it('solo un GERENTE crea (403 a un auditor) y puede haber varios seguimientos de la misma anterior', async () => {
    const prev = await closedAudit()
    expect((await followUp(prev, {}, 'auditor', 'ana')).status).toBe(403)
    expect((await followUp(prev)).status).toBe(201)
    expect((await followUp(prev, { name: 'Otro seguimiento' })).status).toBe(201)
  })

  it('un seguimiento de un seguimiento apunta a la anterior INMEDIATA, no a la primera', async () => {
    const first = await closedAudit()
    const secondId = (await followUp(first)).body.data.id as string
    // el primer seguimiento se da por cerrado con todo cumplido
    const cumple = levelId(first, 'Cumple')
    await db.evaluation.updateMany({
      where: { auditId: secondId },
      data: { status: 'APPROVED', achievedLevelId: cumple, isNotApplicable: false, notApplicableReason: null },
    })
    await db.audit.update({ where: { id: secondId }, data: { status: 'CLOSED' } })
    const thirdId = (await post(A, { name: 'Tercero', previousAuditId: secondId })).body.data.id as string
    const roles = await evalOf(thirdId, 'Roles')
    const before = await db.evaluation.findUniqueOrThrow({ where: { id: roles.carriedFromId! } })
    expect(before.auditId).toBe(secondId)
    expect((await get(`${A}/${thirdId}`)).body.data.previousAudit.id).toBe(secondId)
  })
})

describe('el seguimiento en marcha', () => {
  /** Un seguimiento (con lo del ejemplo trasladado) con equipo armado, listo para iniciarse. */
  async function readyFollowUp() {
    const prev = await closedAudit()
    const id = (await followUp(prev)).body.data.id as string
    const [ana, lead] = await Promise.all([t.userId('auditor', 'ana'), t.userId('auditor', 'lider')])
    await post(`${A}/${id}/members`, { userId: lead, role: 'LEAD' })
    await post(`${A}/${id}/members`, { userId: ana, role: 'MEMBER' })
    return { prev, id, ana, lead }
  }

  it('iniciar solo exige asignar lo que falta evaluar: los trasladados no tienen a quién asignarse', async () => {
    const { id, ana } = await readyFollowUp()
    const blocked = await post(`${A}/${id}/start`, {})
    expect(blocked.status).toBe(422)
    expect(blocked.body.error).toMatchObject({ code: 'AUDIT_UNASSIGNED_EVALUATIONS', details: { missing: 1 } }) // solo «Roles»
    const roles = await evalOf(id, 'Roles')
    const assigned = await api()
      .put(`${A}/${id}/assignments`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: [roles.id], userId: ana })
    expect(assigned.status).toBe(200)
    expect((await post(`${A}/${id}/start`, {})).status).toBe(200)
  })

  it('los resultados dicen cuántos criterios son trasladados (siguen contando como cumplidos)', async () => {
    const { id, ana } = await readyFollowUp()
    await api()
      .put(`${A}/${id}/assignments`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: [(await evalOf(id, 'Roles')).id], userId: ana })
    await post(`${A}/${id}/start`, {})
    const { overall, domains, progress } = (await get(`${A}/${id}/results`)).body.data
    expect(progress).toMatchObject({ total: 4, approved: 3, notStarted: 1 })
    expect(overall).toMatchObject({ total: 4, carriedOver: 3, evaluated: 2, meets: 2, notApplicable: 1, pending: 1 })
    expect(domains.map((d: { carriedOver: number }) => d.carriedOver)).toEqual([1, 2])
    const list = (await get(`${A}/${id}/evaluations`)).body.data as Array<{
      control: { title: string }
      carriedFromId: string | null
    }>
    expect(
      list
        .filter((e) => e.carriedFromId !== null)
        .map((e) => e.control.title)
        .sort(),
    ).toEqual(['Antecedentes', 'Contratos', 'Políticas'])
  })

  it('de punta a punta: se evalúa solo lo pendiente, se aprueba y se CIERRA (lo trasladado ya estaba aprobado)', async () => {
    const { prev, id, ana } = await readyFollowUp()
    const roles = await evalOf(id, 'Roles')
    const lider = await as('auditor', 'lider')
    const anaToken = await as('auditor', 'ana')
    await api()
      .put(`${A}/${id}/assignments`)
      .set('authorization', lider)
      .send({ evaluationIds: [roles.id], userId: ana })
    await post(`${A}/${id}/start`, {})
    const url = `${A}/${id}/evaluations/${roles.id}`
    // en el nivel mínimo no hace falta evidencia, solo hallazgo
    await api()
      .patch(url)
      .set('authorization', anaToken)
      .send({ achievedLevelId: levelId(prev, 'No cumple'), findings: 'Sigue sin cerrarse' })
    expect((await api().post(`${url}/complete`).set('authorization', anaToken)).status).toBe(200)
    expect((await api().post(`${url}/approve`).set('authorization', lider).send({})).status).toBe(200)
    const closed = await post(`${A}/${id}/close`, {})
    expect(closed.status).toBe(200)
    expect(closed.body.data.status).toBe('CLOSED')
  })

  it('el líder puede reabrir un trasladado: deja de serlo, conserva el contenido y hay que asignarlo para re-evaluarlo', async () => {
    const { id, ana } = await readyFollowUp()
    const lider = await as('auditor', 'lider')
    await api()
      .put(`${A}/${id}/assignments`)
      .set('authorization', lider)
      .send({ evaluationIds: [(await evalOf(id, 'Roles')).id], userId: ana })
    await post(`${A}/${id}/start`, {})

    const politicas = await evalOf(id, 'Políticas')
    const url = `${A}/${id}/evaluations/${politicas.id}`
    const reopened = await api()
      .post(`${url}/reopen`)
      .set('authorization', lider)
      .send({ comments: 'El cliente pidió re-evaluar' })
    expect(reopened.status).toBe(200)
    expect(reopened.body.data).toMatchObject({ status: 'RETURNED', carriedFromId: null, notes: 'Revisado con TI' })
    expect((await get(`${A}/${id}/results`)).body.data.overall.carriedOver).toBe(2)

    // sin asignar nadie lo edita; al asignarlo, el auditor lo puede trabajar
    const anaToken = await as('auditor', 'ana')
    expect((await api().patch(url).set('authorization', anaToken).send({ notes: 'x' })).status).toBe(403)
    await api()
      .put(`${A}/${id}/assignments`)
      .set('authorization', lider)
      .send({ evaluationIds: [politicas.id], userId: ana })
    expect((await api().patch(url).set('authorization', anaToken).send({ notes: 'Actualizado' })).status).toBe(200)
  })
})
