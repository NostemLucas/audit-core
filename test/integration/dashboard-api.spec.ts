import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { type TestRole, useTestApi } from './support/api.js'
import { startedAudit } from './support/started-audit.js'

const t = useTestApi()
const { api, as, db } = t

const summary = async (role: TestRole = 'manager', who?: string) =>
  api()
    .get('/api/v1/dashboard/summary')
    .set('authorization', await as(role, who))
const myWork = async (role: TestRole = 'auditor', who?: string) =>
  api()
    .get('/api/v1/dashboard/my-work')
    .set('authorization', await as(role, who))

const evalOf = (auditId: string, title: string) =>
  db.evaluation.findFirstOrThrow({ where: { auditId, control: { title } } })
const DAY = 24 * 60 * 60 * 1000

describe('GET /dashboard/summary', () => {
  it('cuenta las auditorías por estado y las evaluaciones enviadas a revisión, dentro de lo que el actor ve', async () => {
    const draft = await startedAudit(t, 'CONFORMITY', '-draft')
    await db.audit.update({ where: { id: draft.auditId }, data: { status: 'DRAFT' } })
    const running = await startedAudit(t, 'CONFORMITY', '-running')
    const roles = await evalOf(running.auditId, 'Roles')
    await db.evaluation.update({ where: { id: roles.id }, data: { status: 'COMPLETED' } })

    const res = await summary()
    expect(res.status).toBe(200)
    expect(res.body.data.audits.byStatus).toMatchObject({ DRAFT: 1, IN_PROGRESS: 1, CLOSED: 0, ARCHIVED: 0 })
    expect(res.body.data.audits.total).toBe(2)
    expect(res.body.data.evaluations.pendingReview).toBe(1)
  })

  it('los vencimientos solo cuentan auditorías EN CURSO: vencida (overdue) y por vencer en 14 días (upcoming)', async () => {
    const overdue = await startedAudit(t, 'CONFORMITY', '-overdue')
    await db.audit.update({ where: { id: overdue.auditId }, data: { plannedEnd: new Date(Date.now() - DAY) } })
    const soon = await startedAudit(t, 'CONFORMITY', '-soon')
    await db.audit.update({ where: { id: soon.auditId }, data: { plannedEnd: new Date(Date.now() + 5 * DAY) } })
    const far = await startedAudit(t, 'CONFORMITY', '-far')
    await db.audit.update({ where: { id: far.auditId }, data: { plannedEnd: new Date(Date.now() + 60 * DAY) } })
    const noDeadline = await startedAudit(t, 'CONFORMITY', '-nodl')
    void noDeadline

    const res = await summary()
    expect(res.body.data.deadlines).toEqual({ overdue: 1, upcoming: 1 })
  })

  it('una auditoría cerrada vencida no cuenta como vencida (ya no está en curso)', async () => {
    const ctx = await startedAudit(t, 'CONFORMITY', '-closed')
    await db.audit.update({
      where: { id: ctx.auditId },
      data: { status: 'CLOSED', plannedEnd: new Date(Date.now() - 10 * DAY) },
    })
    const res = await summary()
    expect(res.body.data.deadlines.overdue).toBe(0)
  })

  it('ADMIN y GERENTE ven TODAS las auditorías; un auditor solo las suyas (docs/06 §1, misma regla que GET /audits)', async () => {
    await startedAudit(t, 'CONFORMITY', '-x')
    await startedAudit(t, 'CONFORMITY', '-y')
    const admin = await summary('admin')
    const manager = await summary('manager')
    const otherManager = await summary('manager', 'otro')
    expect(admin.body.data.audits.total).toBe(2)
    expect(manager.body.data.audits.total).toBe(2)
    expect(otherManager.body.data.audits.total).toBe(2) // GERENTE ve todas, no solo las que dirige

    const outsider = await summary('auditor', 'ajeno')
    expect(outsider.body.data.audits.total).toBe(0)
    const participant = await summary('auditor', 'ana') // asignada en ambas por `startedAudit`
    expect(participant.body.data.audits.total).toBe(2)
  })
})

describe('GET /dashboard/my-work', () => {
  it('toEvaluate: lo asignado a mí sin terminar (no lo ya enviado ni lo aprobado)', async () => {
    const ctx = await startedAudit(t)
    const politicas = await evalOf(ctx.auditId, 'Políticas')
    await db.evaluation.update({ where: { id: politicas.id }, data: { status: 'COMPLETED' } })

    const res = await myWork('auditor', 'ana')
    expect(res.status).toBe(200)
    const titles = res.body.data.toEvaluate.map((item: { control: { title: string } }) => item.control.title)
    expect(titles).toContain('Roles') // NOT_STARTED
    expect(titles).not.toContain('Políticas') // COMPLETED: ya no es mío que hacer
    expect(res.body.data.toEvaluate[0]).toMatchObject({
      auditId: ctx.auditId,
      control: { title: 'Roles', reference: 'A.5.2' },
      status: 'NOT_STARTED',
    })
  })

  it('toEvaluate incluye lo devuelto (RETURNED): hay que corregirlo', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await db.evaluation.update({ where: { id: roles.id }, data: { status: 'RETURNED' } })
    const res = await myWork('auditor', 'ana')
    expect(res.body.data.toEvaluate.map((i: { evaluationId: string }) => i.evaluationId)).toContain(roles.id)
  })

  it('toReview: lo que me llegó como líder (COMPLETED); no lo que sigue en curso ni lo ya aprobado', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    const politicas = await evalOf(ctx.auditId, 'Políticas')
    await db.evaluation.update({ where: { id: roles.id }, data: { status: 'COMPLETED' } })
    await db.evaluation.update({ where: { id: politicas.id }, data: { status: 'APPROVED' } })

    const res = await myWork('auditor', 'lider')
    const titles = res.body.data.toReview.map((item: { control: { title: string } }) => item.control.title)
    expect(titles).toEqual(['Roles'])
  })

  it('un auditor asignado, pero NO líder, no ve nada en toReview aunque haya criterios COMPLETED', async () => {
    const ctx = await startedAudit(t)
    const roles = await evalOf(ctx.auditId, 'Roles')
    await db.evaluation.update({ where: { id: roles.id }, data: { status: 'COMPLETED' } })
    const res = await myWork('auditor', 'ana')
    expect(res.body.data.toReview).toEqual([])
  })

  it('managing: mis auditorías en curso, con cuántos criterios no están aprobados todavía', async () => {
    const ctx = await startedAudit(t)
    const ids = (await db.evaluation.findMany({ where: { auditId: ctx.auditId } })).map((e) => e.id)
    await db.evaluation.update({ where: { id: ids[0]! }, data: { status: 'APPROVED' } })

    const res = await myWork('manager', 'manager')
    const item = res.body.data.managing.find((m: { auditId: string }) => m.auditId === ctx.auditId)
    expect(item).toMatchObject({ auditCode: expect.any(String), status: 'IN_PROGRESS', pendingCount: 3 }) // 4 - 1 aprobado
  })

  it('managing no incluye una auditoría en borrador ni una cerrada (solo en curso)', async () => {
    const draft = await startedAudit(t, 'CONFORMITY', '-md')
    await db.audit.update({ where: { id: draft.auditId }, data: { status: 'DRAFT' } })
    const closed = await startedAudit(t, 'CONFORMITY', '-mc')
    await db.evaluation.updateMany({ where: { auditId: closed.auditId }, data: { status: 'APPROVED' } })
    await db.audit.update({ where: { id: closed.auditId }, data: { status: 'CLOSED' } })

    const res = await myWork('manager', 'manager')
    const ids = res.body.data.managing.map((m: { auditId: string }) => m.auditId)
    expect(ids).not.toContain(draft.auditId)
    expect(ids).not.toContain(closed.auditId)
  })

  it('las tres listas se ordenan por el vencimiento más próximo primero', async () => {
    const far = await startedAudit(t, 'CONFORMITY', '-of')
    await db.audit.update({ where: { id: far.auditId }, data: { plannedEnd: new Date(Date.now() + 30 * DAY) } })
    const soon = await startedAudit(t, 'CONFORMITY', '-os')
    await db.audit.update({ where: { id: soon.auditId }, data: { plannedEnd: new Date(Date.now() + 2 * DAY) } })

    const managerRes = await myWork('manager', 'manager')
    const managed = managerRes.body.data.managing.filter((m: { auditId: string }) =>
      [far.auditId, soon.auditId].includes(m.auditId),
    )
    expect(managed.map((m: { auditId: string }) => m.auditId)).toEqual([soon.auditId, far.auditId])

    // "ana" tiene criterios asignados en ambas (las asigna `startedAudit`): también le salen antes los de `soon`.
    const anaRes = await myWork('auditor', 'ana')
    const toEvaluate = anaRes.body.data.toEvaluate.filter((i: { auditId: string }) =>
      [far.auditId, soon.auditId].includes(i.auditId),
    )
    expect(toEvaluate.map((i: { auditId: string }) => i.auditId)).toEqual([
      soon.auditId,
      soon.auditId,
      soon.auditId,
      soon.auditId,
      far.auditId,
      far.auditId,
      far.auditId,
      far.auditId,
    ])
  })

  it('cada lista tiene un tope fijo (no es un listado completo): con 12 auditorías, se ven 10', async () => {
    for (let i = 0; i < 12; i++) await startedAudit(t, 'CONFORMITY', `-cap${i}`)
    const managerRes = await myWork('manager', 'manager')
    expect(managerRes.body.data.managing).toHaveLength(10)
    // "ana" tiene los 4 criterios de cada una de las 12 auditorías asignados (48 en total): también se topa en 10.
    const anaRes = await myWork('auditor', 'ana')
    expect(anaRes.body.data.toEvaluate).toHaveLength(10)
  })

  it('sin nada pendiente, las tres listas vienen vacías, no un error', async () => {
    const res = await myWork('auditor', 'nadie-en-ninguna-auditoria')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ toEvaluate: [], toReview: [], managing: [] })
  })
})
