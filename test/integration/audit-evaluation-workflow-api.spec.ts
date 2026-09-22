import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { renderEventMessage } from '../../src/platform/events/index.js'
import { type TestRole, useTestApi } from './support/api.js'
import { libraryFixture } from './support/audits.js'
import { type StartedAudit, startedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

type Ctx = StartedAudit

const inProgress = (dimension: 'CONFORMITY' | 'MATURITY' = 'CONFORMITY', suffix = '') =>
  startedAudit(t, dimension, suffix)

const level = (ctx: Ctx, label: string) => ctx.lib.scale.levels.find((l) => l.label === label)!.id
const evaluationOf = async (ctx: Ctx, title: string) =>
  (await db.evaluation.findFirstOrThrow({ where: { auditId: ctx.auditId, control: { title } } })).id
const url = (ctx: Ctx, evaluationId: string, action = '') => `${A}/${ctx.auditId}/evaluations/${evaluationId}${action}`
/** La versión se toma de la BD salvo que el test la indique (para probar el conflicto, docs/06 §10). */
const patch = async (ctx: Ctx, id: string, body: Record<string, unknown>, role: TestRole = 'auditor', who = 'ana') =>
  api()
    .patch(url(ctx, id))
    .set('authorization', await as(role, who))
    .send({ version: (await db.evaluation.findUnique({ where: { id } }))?.version ?? 0, ...body })
const complete = async (ctx: Ctx, id: string, role: TestRole = 'auditor', who = 'ana') =>
  api()
    .post(url(ctx, id, '/complete'))
    .set('authorization', await as(role, who))
const approve = async (
  ctx: Ctx,
  id: string,
  body: Record<string, unknown> = {},
  role: TestRole = 'auditor',
  who = 'lider',
) =>
  api()
    .post(url(ctx, id, '/approve'))
    .set('authorization', await as(role, who))
    .send(body)
const giveBack = async (
  ctx: Ctx,
  id: string,
  body: Record<string, unknown>,
  role: TestRole = 'auditor',
  who = 'lider',
) =>
  api()
    .post(url(ctx, id, '/return'))
    .set('authorization', await as(role, who))
    .send(body)
const reopen = async (ctx: Ctx, id: string, body: Record<string, unknown>, role: TestRole = 'auditor', who = 'lider') =>
  api()
    .post(url(ctx, id, '/reopen'))
    .set('authorization', await as(role, who))
    .send(body)
const evidence = (evaluationId: string, title = 'Acta de comité', extra: { deletedAt?: Date } = {}) =>
  db.evidence.create({
    data: {
      evaluationId,
      title,
      fileName: 'acta.pdf',
      mimeType: 'application/pdf',
      size: 1024n,
      storageFileId: `nc-${Math.random().toString(36).slice(2)}`,
      ...extra,
    },
  })
const historyOf = (evaluationId: string) =>
  db.auditEvent.findMany({
    where: { subjectType: 'Evaluation', subjectId: evaluationId },
    orderBy: { createdAt: 'asc' },
  })
const statusOf = async (id: string) => (await db.evaluation.findUniqueOrThrow({ where: { id } })).status

describe('editar el contenido (solo el auditor asignado)', () => {
  it('la primera edición ARRANCA el criterio (NOT_STARTED → IN_PROGRESS, con su evento) y guarda el contenido', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    const res = await patch(ctx, id, {
      achievedLevelId: level(ctx, 'Parcial'),
      findings: 'Falta el acta',
      notes: 'revisar con TI',
    })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      status: 'IN_PROGRESS',
      achievedLevel: { label: 'Parcial' },
      findings: 'Falta el acta',
      notes: 'revisar con TI',
      isNotApplicable: false,
      evidenceCount: 0,
    })
    const started = (await historyOf(id)).find((e) => e.type === 'EvaluationStarted')!
    expect(started).toMatchObject({ type: 'EvaluationStarted', subjectType: 'Evaluation' })
    expect(renderEventMessage(started!.type, started!.payload)).toBe('Comenzó a trabajar en «Roles»')
  })

  it('las ediciones siguientes no vuelven a arrancarlo ni dejan rastro; los campos ausentes no se tocan y null los borra', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { findings: 'uno', notes: 'nota' })
    await patch(ctx, id, { findings: 'dos' })
    const view = (await patch(ctx, id, { notes: null })).body.data
    expect(view).toMatchObject({ findings: 'dos', notes: null })
    expect((await historyOf(id)).map((e) => e.type)).toEqual(['EvaluationAssigned', 'EvaluationStarted'])
  })

  it('solo el auditor ASIGNADO: otro auditor, el líder, el manager y el ADMIN reciben 403', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    const other = await patch(ctx, id, { notes: 'x' }, 'auditor', 'luis')
    expect(other.status).toBe(403)
    expect(other.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'ASSIGNED_MEMBER' } })
    expect((await patch(ctx, id, { notes: 'x' }, 'auditor', 'lider')).status).toBe(403)
    expect((await patch(ctx, id, { notes: 'x' }, 'manager', 'manager')).status).toBe(403)
    expect((await patch(ctx, id, { notes: 'x' }, 'admin', 'admin')).status).toBe(403)
    expect(await statusOf(id)).toBe('NOT_STARTED')
  })

  it('con la auditoría fuera de curso: 409 AUDIT_NOT_EVALUABLE (borrador, cerrada, archivada)', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    for (const status of ['DRAFT', 'CLOSED', 'ARCHIVED'] as const) {
      await db.audit.update({ where: { id: ctx.auditId }, data: { status } })
      const res = await patch(ctx, id, { notes: 'x' })
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('AUDIT_NOT_EVALUABLE')
    }
  })

  it('un criterio enviado a revisión o aprobado no se edita: 409 EVALUATION_NOT_EDITABLE', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    for (const status of ['COMPLETED', 'APPROVED'] as const) {
      await db.evaluation.update({ where: { id }, data: { status } })
      const res = await patch(ctx, id, { notes: 'x' })
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('EVALUATION_NOT_EDITABLE')
    }
    await db.evaluation.update({ where: { id }, data: { status: 'RETURNED' } })
    expect((await patch(ctx, id, { notes: 'sí' })).status).toBe(200) // devuelto SÍ se edita
  })

  it('un nivel de otra escala: 422; criterio de otra auditoría o inexistente: 404; cuerpo vacío o inválido: 400', async () => {
    const ctx = await inProgress()
    const other = await libraryFixture(db, '-2')
    const id = await evaluationOf(ctx, 'Roles')
    const foreign = await patch(ctx, id, { achievedLevelId: other.scale.levels[0]!.id })
    expect(foreign.status).toBe(422)
    expect(foreign.body.error.code).toBe('EVALUATION_LEVEL_NOT_IN_SCALE')
    expect((await patch(ctx, UNKNOWN_ID, { notes: 'x' })).body.error.code).toBe('EVALUATION_NOT_FOUND')
    expect((await patch(ctx, id, {})).status).toBe(400)
    expect((await patch(ctx, id, { achievedLevelId: 'x' })).status).toBe(400)
  })

  it('"no aplica": exige motivo, borra el nivel alcanzado, y es excluyente con él (se desmarca de forma explícita)', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { achievedLevelId: level(ctx, 'Cumple') })

    const noReason = await patch(ctx, id, { isNotApplicable: true })
    expect(noReason.status).toBe(422)
    expect(noReason.body.error.code).toBe('NOT_APPLICABLE_REASON_REQUIRED')

    const both = await patch(ctx, id, {
      isNotApplicable: true,
      notApplicableReason: 'x',
      achievedLevelId: level(ctx, 'Parcial'),
    })
    expect(both.status).toBe(400) // no se puede en el mismo envío

    const na = await patch(ctx, id, { isNotApplicable: true, notApplicableReason: 'El sistema no existe' })
    expect(na.body.data).toMatchObject({
      isNotApplicable: true,
      notApplicableReason: 'El sistema no existe',
      achievedLevel: null,
    })

    const conflict = await patch(ctx, id, { achievedLevelId: level(ctx, 'Cumple') })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('EVALUATION_IS_NOT_APPLICABLE')

    const back = await patch(ctx, id, { isNotApplicable: false, achievedLevelId: level(ctx, 'Parcial') })
    expect(back.body.data).toMatchObject({
      isNotApplicable: false,
      notApplicableReason: null,
      achievedLevel: { label: 'Parcial' },
    })
  })

  it('volver a marcar "no aplica" reutiliza el motivo que ya tenía', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { isNotApplicable: true, notApplicableReason: 'motivo original' })
    expect((await patch(ctx, id, { isNotApplicable: true })).body.data.notApplicableReason).toBe('motivo original')
  })
})

describe('enviar a revisión: qué se exige (docs/06 §3)', () => {
  it('cumple, con evidencia: se envía; el evento guarda una COPIA de lo enviado (nivel, hallazgos, notas, evidencias)', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    const proof = await evidence(id, 'Acta de comité')
    await patch(ctx, id, { achievedLevelId: level(ctx, 'Cumple'), notes: 'ok' })
    const res = await complete(ctx, id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', evidenceCount: 1 })

    const sent = (await historyOf(id)).find((e) => e.type === 'EvaluationCompleted')!
    expect(sent.payload).toMatchObject({
      controlTitle: 'Roles',
      achievedLevelLabel: 'Cumple',
      isNotApplicable: false,
      findings: null,
      notes: 'ok',
      evidence: [{ id: proof.id, title: 'Acta de comité' }],
    })
    expect(renderEventMessage(sent.type, sent.payload)).toBe('Envió «Roles» a revisión')
  })

  it('sin nivel alcanzado ni "no aplica": 422 con lo que falta', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { notes: 'solo una nota' })
    const res = await complete(ctx, id)
    expect(res.status).toBe(422)
    expect(res.body.error).toMatchObject({
      code: 'EVALUATION_INCOMPLETE',
      details: { missing: ['ACHIEVED_LEVEL_OR_NOT_APPLICABLE'] },
    })
    expect(await statusOf(id)).toBe('IN_PROGRESS')
  })

  it('por encima del mínimo y por debajo de lo esperado: hace falta hallazgo Y evidencia, en ese orden', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { achievedLevelId: level(ctx, 'Parcial') }) // esperado Cumple, mínimo No cumple
    expect((await complete(ctx, id)).body.error.details.missing).toEqual(['FINDINGS', 'EVIDENCE'])
    await patch(ctx, id, { findings: 'Cubre solo la mitad' })
    expect((await complete(ctx, id)).body.error.details.missing).toEqual(['EVIDENCE'])
    await evidence(id)
    expect((await complete(ctx, id)).status).toBe(200)
  })

  it('en el nivel MÍNIMO no se exige evidencia (el hallazgo ES la ausencia), pero sí el hallazgo', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { achievedLevelId: level(ctx, 'No cumple') })
    expect((await complete(ctx, id)).body.error.details.missing).toEqual(['FINDINGS'])
    await patch(ctx, id, { findings: 'Se pidió la política y no existe' })
    const res = await complete(ctx, id)
    expect(res.status).toBe(200)
    expect(res.body.data.evidenceCount).toBe(0)
  })

  it('"no aplica" con motivo se envía sin nivel, hallazgo ni evidencia', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { isNotApplicable: true, notApplicableReason: 'Sin el sistema' })
    const res = await complete(ctx, id)
    expect(res.status).toBe(200)
    const sent = (await historyOf(id)).find((e) => e.type === 'EvaluationCompleted')!
    expect(sent.payload).toMatchObject({
      isNotApplicable: true,
      notApplicableReason: 'Sin el sistema',
      achievedLevelLabel: null,
    })
  })

  it('una evidencia eliminada (deletedAt) no cuenta', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await evidence(id, 'Borrada', { deletedAt: new Date() })
    await patch(ctx, id, { achievedLevelId: level(ctx, 'Cumple') })
    const res = await complete(ctx, id)
    expect(res.status).toBe(422)
    expect(res.body.error.details.missing).toEqual(['EVIDENCE'])
  })

  it('en una escala MATURITY el esperado lo fija el líder: superarlo no pide hallazgo, pero sí evidencia (está sobre el mínimo)', async () => {
    const ctx = await inProgress('MATURITY', '-m')
    const id = await evaluationOf(ctx, 'Roles') // esperado: Parcial
    await patch(ctx, id, { achievedLevelId: level(ctx, 'Cumple') })
    expect((await complete(ctx, id)).body.error.details.missing).toEqual(['EVIDENCE'])
    await evidence(id)
    expect((await complete(ctx, id)).status).toBe(200)
  })

  it('el ciclo de vida gana a las precondiciones: sin haberlo editado (NOT_STARTED) o ya enviado es 409, no 422', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    const untouched = await complete(ctx, id)
    expect(untouched.status).toBe(409)
    expect(untouched.body.error).toMatchObject({
      code: 'EVALUATION_INVALID_STATE',
      details: { from: 'NOT_STARTED', event: 'COMPLETE' },
    })
    await db.evaluation.update({ where: { id }, data: { status: 'COMPLETED' } })
    expect((await complete(ctx, id)).body.error.code).toBe('EVALUATION_INVALID_STATE')
  })

  it('solo el auditor asignado envía; con la auditoría fuera de curso, 409', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { achievedLevelId: level(ctx, 'No cumple'), findings: 'x' })
    expect((await complete(ctx, id, 'auditor', 'luis')).status).toBe(403)
    expect((await complete(ctx, id, 'auditor', 'lider')).status).toBe(403)
    await db.audit.update({ where: { id: ctx.auditId }, data: { status: 'CLOSED' } })
    expect((await complete(ctx, id)).body.error.code).toBe('AUDIT_NOT_EVALUABLE')
  })

  it('atomicidad: si falla el historial, el criterio no queda enviado', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    await patch(ctx, id, { achievedLevelId: level(ctx, 'No cumple'), findings: 'x' })
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_event() RETURNS trigger AS $$
      BEGIN IF NEW."type" = 'EvaluationCompleted' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_event BEFORE INSERT ON "audit_events" FOR EACH ROW EXECUTE FUNCTION test_fail_event()`,
    )
    try {
      expect((await complete(ctx, id)).status).toBe(500)
      expect(await statusOf(id)).toBe('IN_PROGRESS')
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_fail_event ON "audit_events"')
      await db.$executeRawUnsafe('DROP FUNCTION test_fail_event()')
    }
  })
})

describe('revisar (solo el líder)', () => {
  /** Un criterio ya enviado a revisión, en el nivel mínimo (no exige evidencia). */
  async function sent(ctx: Ctx, title = 'Roles', findings = 'v1') {
    const id = await evaluationOf(ctx, title)
    await patch(ctx, id, { achievedLevelId: level(ctx, 'No cumple'), findings })
    expect((await complete(ctx, id)).status).toBe(200)
    return id
  }

  it('aprobar: COMPLETED → APPROVED, comentario opcional, registrado', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx)
    const res = await approve(ctx, id, { comments: 'Conforme' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('APPROVED')
    const event = (await historyOf(id)).find((e) => e.type === 'EvaluationApproved')!
    expect(renderEventMessage(event.type, event.payload)).toBe('Aprobó «Roles»: Conforme')

    const id2 = await sent(ctx, 'Políticas')
    await approve(ctx, id2)
    const plain = (await historyOf(id2)).find((e) => e.type === 'EvaluationApproved')!
    expect(renderEventMessage(plain.type, plain.payload)).toBe('Aprobó «Políticas»')
  })

  it('devolver: exige comentario, pasa a RETURNED y lo registra con el comentario', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx)
    expect((await giveBack(ctx, id, {})).status).toBe(400)
    expect((await giveBack(ctx, id, { comments: '   ' })).status).toBe(400)
    expect(await statusOf(id)).toBe('COMPLETED')
    const res = await giveBack(ctx, id, { comments: 'Falta detallar qué se pidió' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('RETURNED')
    const event = (await historyOf(id)).find((e) => e.type === 'EvaluationReturned')!
    expect(renderEventMessage(event.type, event.payload)).toBe('Devolvió «Roles»: Falta detallar qué se pidió')
  })

  it('reabrir uno aprobado: exige comentario, pasa a RETURNED; uno que no está aprobado es 409', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx)
    expect((await reopen(ctx, id, { comments: 'x' })).body.error.code).toBe('EVALUATION_INVALID_STATE') // aún COMPLETED
    await approve(ctx, id)
    expect((await reopen(ctx, id, {})).status).toBe(400)
    const res = await reopen(ctx, id, { comments: 'Apareció evidencia nueva' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('RETURNED')
    const event = (await historyOf(id)).find((e) => e.type === 'EvaluationReopened')!
    expect(renderEventMessage(event.type, event.payload)).toBe(
      'Reabrió «Roles» (estaba aprobado): Apareció evidencia nueva',
    )
  })

  it('LA HISTORIA de un criterio: cada envío guarda cómo estaba, y se ve qué se corrigió tras la devolución', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx, 'Roles', 'primera versión del hallazgo')
    await giveBack(ctx, id, { comments: 'Sé más específico' })
    await patch(ctx, id, { findings: 'segunda versión, más específica' }) // RETURNED sí se edita
    expect((await complete(ctx, id)).status).toBe(200)
    await approve(ctx, id, { comments: 'Ahora sí' })

    const history = await historyOf(id)
    expect(history.map((e) => e.type)).toEqual([
      'EvaluationAssigned',
      'EvaluationStarted',
      'EvaluationCompleted',
      'EvaluationReturned',
      'EvaluationCompleted',
      'EvaluationApproved',
    ])
    const [first, second] = history.filter((e) => e.type === 'EvaluationCompleted')
    expect((first!.payload as { findings: string }).findings).toBe('primera versión del hallazgo')
    expect((second!.payload as { findings: string }).findings).toBe('segunda versión, más específica')
    // y los actores: el auditor envía, el líder revisa
    const [ana, lider] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { authentikId: 'sub-ana' } }),
      db.user.findUniqueOrThrow({ where: { authentikId: 'sub-lider' } }),
    ])
    expect(history.map((e) => e.actorId)).toEqual([lider.id, ana.id, ana.id, lider.id, ana.id, lider.id])
  })

  it('solo el LÍDER revisa: el auditor asignado, otro auditor, el manager, otro GERENTE y el ADMIN reciben 403', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx)
    const asAuthor = await approve(ctx, id, {}, 'auditor', 'ana')
    expect(asAuthor.status).toBe(403)
    expect(asAuthor.body.error).toMatchObject({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'LEAD' } })
    expect((await approve(ctx, id, {}, 'auditor', 'luis')).status).toBe(403)
    expect((await approve(ctx, id, {}, 'manager', 'manager')).status).toBe(403)
    expect((await approve(ctx, id, {}, 'manager', 'otro')).status).toBe(403)
    expect((await approve(ctx, id, {}, 'admin', 'admin')).status).toBe(403)
    expect((await giveBack(ctx, id, { comments: 'x' }, 'auditor', 'ana')).status).toBe(403)
    expect(await statusOf(id)).toBe('COMPLETED')
  })

  it('reabrir uno aprobado también es solo del líder: el auditor, otro auditor, el manager y el ADMIN reciben 403', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx)
    await approve(ctx, id)
    for (const [role, who] of [
      ['auditor', 'ana'],
      ['auditor', 'luis'],
      ['manager', 'manager'],
      ['admin', 'admin'],
    ] as const) {
      const res = await reopen(ctx, id, { comments: 'x' }, role, who)
      expect(res.status).toBe(403)
      if (role === 'auditor') expect(res.body.error.details.required).toBe('LEAD')
    }
    expect(await statusOf(id)).toBe('APPROVED')
  })

  it('las acciones de revisión exigen el estado correcto: aprobar o devolver algo sin enviar es 409', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    expect((await approve(ctx, id)).body.error).toMatchObject({
      code: 'EVALUATION_INVALID_STATE',
      details: { from: 'NOT_STARTED', event: 'APPROVE' },
    })
    expect((await giveBack(ctx, id, { comments: 'x' })).body.error.code).toBe('EVALUATION_INVALID_STATE')
  })

  it('con la auditoría fuera de curso no se revisa nada (409 AUDIT_NOT_EVALUABLE), tampoco reabrir en una cerrada', async () => {
    const ctx = await inProgress()
    const id = await sent(ctx)
    await approve(ctx, id)
    await db.audit.update({ where: { id: ctx.auditId }, data: { status: 'CLOSED' } })
    expect((await reopen(ctx, id, { comments: 'x' })).body.error.code).toBe('AUDIT_NOT_EVALUABLE')
    expect((await approve(ctx, id)).body.error.code).toBe('AUDIT_NOT_EVALUABLE')
    // devolver también: uno enviado (COMPLETED) en una auditoría cerrada, para que solo falle por la auditoría
    const other = await evaluationOf(ctx, 'Políticas')
    await db.evaluation.update({ where: { id: other }, data: { status: 'COMPLETED' } })
    expect((await giveBack(ctx, other, { comments: 'x' })).body.error.code).toBe('AUDIT_NOT_EVALUABLE')
    expect(await statusOf(id)).toBe('APPROVED')
  })
})

describe('ver un criterio', () => {
  it('lo ven los miembros y quien puede ver la auditoría; uno ajeno o de otra auditoría es 404; un auditor ajeno, 403', async () => {
    const ctx = await inProgress()
    const id = await evaluationOf(ctx, 'Roles')
    const get = async (evaluationId: string, role: TestRole = 'auditor', who = 'luis') =>
      api()
        .get(url(ctx, evaluationId))
        .set('authorization', await as(role, who))
    const view = await get(id)
    expect(view.status).toBe(200)
    expect(view.body.data).toMatchObject({
      id,
      control: { title: 'Roles' },
      assignedUser: { name: 'ana' },
      evidenceCount: 0,
    })
    expect((await get(id, 'admin', 'admin')).status).toBe(200)
    expect((await get(id, 'auditor', 'ajeno')).status).toBe(403)
    expect((await get(UNKNOWN_ID)).body.error.code).toBe('EVALUATION_NOT_FOUND')
    const other = await inProgress('CONFORMITY', '-2')
    expect((await get(await evaluationOf(other, 'Roles'))).body.error.code).toBe('EVALUATION_NOT_FOUND') // de otra auditoría
  })
})

describe('de punta a punta por la API', () => {
  it('crear → equipo → asignar → iniciar → evaluar, enviar y aprobar cada criterio → cerrar → archivar', async () => {
    const ctx = await inProgress()
    const ids = (await db.evaluation.findMany({ where: { auditId: ctx.auditId }, orderBy: { id: 'asc' } })).map(
      (e) => e.id,
    )
    expect(ids).toHaveLength(4)

    // cerrar ahora falla: nada está aprobado
    const early = await api()
      .post(`${A}/${ctx.auditId}/close`)
      .set('authorization', await as('manager'))
    expect(early.body.error).toMatchObject({ code: 'AUDIT_HAS_PENDING_EVALUATIONS', details: { pending: 4 } })

    for (const id of ids) {
      await evidence(id)
      expect((await patch(ctx, id, { achievedLevelId: level(ctx, 'Cumple') })).status).toBe(200)
      expect((await complete(ctx, id)).status).toBe(200)
      expect((await approve(ctx, id)).status).toBe(200)
    }
    const closed = await api()
      .post(`${A}/${ctx.auditId}/close`)
      .set('authorization', await as('manager'))
    expect(closed.body.data.status).toBe('CLOSED')
    const archived = await api()
      .post(`${A}/${ctx.auditId}/archive`)
      .set('authorization', await as('manager'))
    expect(archived.body.data.status).toBe('ARCHIVED')

    const types = (
      await db.auditEvent.findMany({ where: { auditId: ctx.auditId }, orderBy: { createdAt: 'asc' } })
    ).map((e) => e.type)
    expect(types.filter((x) => x === 'EvaluationApproved')).toHaveLength(4)
    expect(types.at(-2)).toBe('AuditClosed')
    expect(types.at(-1)).toBe('AuditArchived')
  })
})
