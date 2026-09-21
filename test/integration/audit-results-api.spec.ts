import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { type TestRole, useTestApi } from './support/api.js'
import { auditBody, libraryFixture } from './support/audits.js'
import { type StartedAudit, startedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

const levelId = (ctx: StartedAudit, label: string) => ctx.lib.scale.levels.find((l) => l.label === label)!.id
const evalId = async (ctx: StartedAudit, title: string) =>
  (await db.evaluation.findFirstOrThrow({ where: { auditId: ctx.auditId, control: { title } } })).id

/** Deja un criterio como se quiere, directo en la BD: estas pruebas miden LO QUE SE LEE, no el flujo (ver el spec del flujo). */
async function setEvaluation(
  ctx: StartedAudit,
  title: string,
  data: {
    achieved?: string
    expected?: string
    status?: 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED'
    na?: boolean
    findings?: string
  },
) {
  await db.evaluation.update({
    where: { id: await evalId(ctx, title) },
    data: {
      ...(data.achieved && { achievedLevelId: levelId(ctx, data.achieved) }),
      ...(data.expected && { expectedLevelId: levelId(ctx, data.expected) }),
      ...(data.status && { status: data.status }),
      ...(data.na && { isNotApplicable: true, notApplicableReason: 'No existe' }),
      ...(data.findings && { findings: data.findings }),
    },
  })
}

const get = async (path: string, role: TestRole = 'manager', who?: string) =>
  api()
    .get(path)
    .set('authorization', await as(role, who))

describe('GET /audits/:id/results', () => {
  it('recién iniciada: todo pendiente, sin promedios (null, no cero) y con todas las opciones de la escala en cero', async () => {
    const ctx = await startedAudit(t)
    const res = await get(`${A}/${ctx.auditId}/results`)
    expect(res.status).toBe(200)
    const { progress, overall, domains } = res.body.data
    expect(progress).toEqual({ total: 4, notStarted: 4, inProgress: 0, completed: 0, returned: 0, approved: 0 })
    expect(overall).toMatchObject({ total: 4, pending: 4, evaluated: 0, meets: 0, below: 0, notApplicable: 0 })
    expect(overall.distribution.map((d: { label: string; count: number }) => [d.label, d.count])).toEqual([
      ['No cumple', 0],
      ['Parcial', 0],
      ['Cumple', 0],
    ])
    expect(domains.map((d: { domain: { title: string } }) => d.domain.title)).toEqual(['Organizacionales', 'Personas'])
    expect(domains[0]).toMatchObject({ total: 2, averageExpected: null, averageAchieved: null, gap: null })
  })

  it('NO hay nota global ni pesos: el total lleva conteos y distribución, y nada más', async () => {
    const ctx = await startedAudit(t)
    const { overall } = (await get(`${A}/${ctx.auditId}/results`)).body.data
    expect(Object.keys(overall).sort()).toEqual(
      ['carriedOver', 'distribution', 'evaluated', 'meets', 'notApplicable', 'pending', 'total', 'below'].sort(),
    )
  })

  it('con avance: cumplen / por debajo / pendientes / no aplica, la distribución y el avance por estado', async () => {
    const ctx = await startedAudit(t)
    await setEvaluation(ctx, 'Políticas', { achieved: 'Cumple', status: 'APPROVED' })
    await setEvaluation(ctx, 'Roles', { achieved: 'Parcial', status: 'COMPLETED' })
    await setEvaluation(ctx, 'Antecedentes', { na: true, status: 'APPROVED' })
    await setEvaluation(ctx, 'Contratos', { status: 'IN_PROGRESS' })

    const { progress, overall, domains } = (await get(`${A}/${ctx.auditId}/results`)).body.data
    expect(progress).toEqual({ total: 4, notStarted: 0, inProgress: 1, completed: 1, returned: 0, approved: 2 })
    expect(overall).toMatchObject({ total: 4, evaluated: 2, meets: 1, below: 1, pending: 1, notApplicable: 1 })
    expect(overall.distribution.map((d: { count: number }) => d.count)).toEqual([0, 1, 1])

    const [org, people] = domains
    expect(org).toMatchObject({ evaluated: 2, meets: 1, below: 1, averageExpected: 100, averageAchieved: 75, gap: -25 })
    // Personas: uno "no aplica" y uno pendiente → no hay evaluados, así que sin promedios (los no aplicables no cuentan)
    expect(people).toMatchObject({
      evaluated: 0,
      notApplicable: 1,
      pending: 1,
      averageExpected: null,
      averageAchieved: null,
      gap: null,
    })
  })

  it('en madurez el esperado varía por criterio: se comparan niveles con niveles y un dominio puede quedar por encima', async () => {
    const ctx = await startedAudit(t, 'MATURITY', '-m') // esperado inicial: Parcial en todos
    await setEvaluation(ctx, 'Políticas', { expected: 'Cumple', achieved: 'Parcial' }) // por debajo
    await setEvaluation(ctx, 'Roles', { achieved: 'Parcial' }) // cumple justo
    await setEvaluation(ctx, 'Antecedentes', { achieved: 'Cumple' }) // por encima
    await setEvaluation(ctx, 'Contratos', { expected: 'Cumple', achieved: 'Cumple' })

    const [org, people] = (await get(`${A}/${ctx.auditId}/results`)).body.data.domains
    expect(org).toMatchObject({ averageExpected: 75, averageAchieved: 50, gap: -25, meets: 1, below: 1 })
    expect(people).toMatchObject({ averageExpected: 75, averageAchieved: 100, gap: 25, meets: 2, below: 0 })
  })

  it('funciona también en borrador (todo pendiente)', async () => {
    const lib = await libraryFixture(db, '-d')
    const created = await api()
      .post(A)
      .set('authorization', await as('manager'))
      .send(auditBody(lib))
    const res = await get(`${A}/${created.body.data.id}/results`)
    expect(res.status).toBe(200)
    expect(res.body.data.overall).toMatchObject({ total: 4, pending: 4 })
  })

  it('lo ven el líder, los auditores, el manager, otro GERENTE y el ADMIN; un auditor ajeno no (403); una inexistente es 404', async () => {
    const ctx = await startedAudit(t)
    const path = `${A}/${ctx.auditId}/results`
    for (const [role, who] of [
      ['auditor', 'lider'],
      ['auditor', 'ana'],
      ['manager', 'manager'],
      ['manager', 'otro'],
      ['admin', 'admin'],
    ] as const) {
      expect((await get(path, role, who)).status, `${role}/${who}`).toBe(200)
    }
    const outsider = await get(path, 'auditor', 'ajeno')
    expect(outsider.status).toBe(403)
    expect(outsider.body.error.code).toBe('AUDIT_ACCESS_DENIED')
    expect((await get(`${A}/${UNKNOWN_ID}/results`)).body.error.code).toBe('AUDIT_NOT_FOUND')
  })
})

describe('GET /audits/:id/gaps', () => {
  it('lista solo los criterios evaluados por debajo de lo esperado, del más lejano al menos, con su brecha', async () => {
    const ctx = await startedAudit(t)
    await setEvaluation(ctx, 'Políticas', { achieved: 'Parcial', findings: 'Cubre la mitad' }) // -50
    await setEvaluation(ctx, 'Roles', { achieved: 'No cumple', findings: 'No existe' }) // -100
    await setEvaluation(ctx, 'Antecedentes', { achieved: 'Cumple' }) // cumple: no aparece
    await setEvaluation(ctx, 'Contratos', { na: true }) // no aplica: no aparece

    const res = await get(`${A}/${ctx.auditId}/gaps`)
    expect(res.status).toBe(200)
    expect(res.body.data.map((g: { control: { title: string }; gap: number }) => [g.control.title, g.gap])).toEqual([
      ['Roles', -100],
      ['Políticas', -50],
    ])
    expect(res.body.data[0]).toMatchObject({
      findings: 'No existe',
      achievedLevel: { label: 'No cumple' },
      expectedLevel: { label: 'Cumple' },
      control: { domain: 'Organizacionales' },
    })
  })

  it('a igual brecha, en el orden de lectura de la plantilla', async () => {
    const ctx = await startedAudit(t)
    // se evalúan en orden inverso al de lectura: el desempate no puede ser el orden de inserción ni de actualización
    for (const title of ['Contratos', 'Antecedentes', 'Roles', 'Políticas'])
      await setEvaluation(ctx, title, { achieved: 'Parcial' })
    const titles = (await get(`${A}/${ctx.auditId}/gaps`)).body.data.map(
      (g: { control: { title: string } }) => g.control.title,
    )
    expect(titles).toEqual(['Políticas', 'Roles', 'Antecedentes', 'Contratos'])
  })

  it('un criterio que justo cumple lo esperado no es una brecha; sin brechas, la lista está vacía', async () => {
    const ctx = await startedAudit(t, 'MATURITY', '-m') // esperado: Parcial
    await setEvaluation(ctx, 'Políticas', { achieved: 'Parcial' })
    const res = await get(`${A}/${ctx.auditId}/gaps`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('mismos permisos de lectura que el resto: un auditor ajeno recibe 403', async () => {
    const ctx = await startedAudit(t)
    expect((await get(`${A}/${ctx.auditId}/gaps`, 'auditor', 'ajeno')).status).toBe(403)
    expect((await get(`${A}/${ctx.auditId}/gaps`, 'auditor', 'luis')).status).toBe(200)
  })
})

describe('GET /audits/:id/history', () => {
  it('lista lo ocurrido, lo más reciente primero, con texto redactado y quién lo hizo', async () => {
    const ctx = await startedAudit(t)
    const res = await get(`${A}/${ctx.auditId}/history`)
    expect(res.status).toBe(200)
    const items = res.body.data as Array<{ type: string; message: string; actor: { name: string } | null }>
    expect(items[0]!.type).toBe('AuditStarted')
    expect(items.at(-1)!.type).toBe('AuditCreated')
    for (const item of items) expect(item.message, item.type).not.toBe(item.type) // todos los eventos tienen su texto
    expect(items[0]!.actor).toMatchObject({ name: expect.any(String) })
    expect(res.body.meta.total).toBe(items.length)
  })

  it('pagina: cada página trae otros eventos y el total no cambia', async () => {
    const ctx = await startedAudit(t)
    const p1 = await get(`${A}/${ctx.auditId}/history?pageSize=3&page=1`)
    const p2 = await get(`${A}/${ctx.auditId}/history?pageSize=3&page=2`)
    expect(p1.body.data).toHaveLength(3)
    expect(p1.body.meta).toMatchObject({ page: 1, pageSize: 3, total: p2.body.meta.total })
    const ids1 = new Set(p1.body.data.map((e: { id: string }) => e.id))
    expect(p2.body.data.some((e: { id: string }) => ids1.has(e.id))).toBe(false)
    expect(p1.body.meta.totalPages).toBeGreaterThan(1)
  })

  it('un evento que ya no existe o con un payload viejo NO rompe la lectura: muestra su tipo', async () => {
    const ctx = await startedAudit(t)
    await db.auditEvent.createMany({
      data: [
        {
          auditId: ctx.auditId,
          type: 'EventoQueYaNoExiste',
          subjectType: 'Audit',
          subjectId: ctx.auditId,
          payload: {},
        },
        {
          auditId: ctx.auditId,
          type: 'EvaluationApproved',
          subjectType: 'Evaluation',
          subjectId: ctx.auditId,
          payload: { formatoViejo: true },
        },
      ],
    })
    const res = await get(`${A}/${ctx.auditId}/history?pageSize=100`)
    expect(res.status).toBe(200)
    const byType = new Map<string, string>(
      res.body.data.map((e: { type: string; message: string }) => [e.type, e.message]),
    )
    expect(byType.get('EventoQueYaNoExiste')).toBe('EventoQueYaNoExiste')
    expect(byType.get('EvaluationApproved')).toBe('EvaluationApproved')
  })

  it('solo lo de ESA auditoría, y con los mismos permisos de lectura', async () => {
    const one = await startedAudit(t)
    const two = await startedAudit(t, 'CONFORMITY', '-2')
    const feed = await get(`${A}/${one.auditId}/history?pageSize=100`)
    const own = await db.auditEvent.count({ where: { auditId: one.auditId } })
    expect(await db.auditEvent.count({ where: { auditId: two.auditId } })).toBeGreaterThan(0)
    expect(feed.body.data).toHaveLength(own)
    expect(feed.body.meta.total).toBe(own)
    expect((await get(`${A}/${one.auditId}/history`, 'auditor', 'ajeno')).status).toBe(403)
    expect((await get(`${A}/${UNKNOWN_ID}/history`)).body.error.code).toBe('AUDIT_NOT_FOUND')
  })
})

describe('GET /audits/:id/evaluations/:evaluationId/history', () => {
  it('la historia de un criterio en orden cronológico, con la copia de lo enviado y los actores', async () => {
    const ctx = await startedAudit(t)
    const id = await evalId(ctx, 'Roles')
    const url = `${A}/${ctx.auditId}/evaluations/${id}`
    const ana = await as('auditor', 'ana')
    const lider = await as('auditor', 'lider')
    await api()
      .patch(url)
      .set('authorization', ana)
      .send({ achievedLevelId: levelId(ctx, 'No cumple'), findings: 'No existe' })
    await api().post(`${url}/complete`).set('authorization', ana)
    await api().post(`${url}/return`).set('authorization', lider).send({ comments: 'Detalla qué se pidió' })

    const res = await get(`${url}/history`, 'auditor', 'luis')
    expect(res.status).toBe(200)
    const entries = res.body.data as Array<{
      type: string
      message: string
      actor: { name: string }
      payload: Record<string, unknown>
    }>
    expect(entries.map((e) => e.type)).toEqual([
      'EvaluationAssigned',
      'EvaluationStarted',
      'EvaluationCompleted',
      'EvaluationReturned',
    ])
    expect(entries[2]!.payload).toMatchObject({ findings: 'No existe', achievedLevelLabel: 'No cumple' })
    expect(entries[3]).toMatchObject({
      message: 'Devolvió «Roles»: Detalla qué se pidió',
      payload: { comments: 'Detalla qué se pidió' },
    })
    expect(entries[3]!.actor.name).toEqual(expect.any(String))
  })

  it('no mezcla criterios: cada uno trae solo su historia', async () => {
    const ctx = await startedAudit(t)
    const roles = await get(`${A}/${ctx.auditId}/evaluations/${await evalId(ctx, 'Roles')}/history`)
    const politicas = await get(`${A}/${ctx.auditId}/evaluations/${await evalId(ctx, 'Políticas')}/history`)
    const subjects = new Set(
      [...roles.body.data, ...politicas.body.data].map((e: { subject: { id: string } }) => e.subject.id),
    )
    expect(subjects.size).toBe(2)
  })

  it('un criterio de otra auditoría o inexistente es 404; un auditor ajeno, 403', async () => {
    const one = await startedAudit(t)
    const two = await startedAudit(t, 'CONFORMITY', '-2')
    const foreign = await evalId(two, 'Roles')
    expect((await get(`${A}/${one.auditId}/evaluations/${foreign}/history`)).body.error.code).toBe(
      'EVALUATION_NOT_FOUND',
    )
    expect((await get(`${A}/${one.auditId}/evaluations/${UNKNOWN_ID}/history`)).status).toBe(404)
    const own = await evalId(one, 'Roles')
    expect((await get(`${A}/${one.auditId}/evaluations/${own}/history`, 'auditor', 'ajeno')).status).toBe(403)
  })
})
