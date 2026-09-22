import { describe, expect, it } from 'vitest'
import '../../src/app-events.js'
import { useTestApi } from './support/api.js'
import { auditBody, libraryFixture } from './support/audits.js'
import { startedAudit } from './support/started-audit.js'

const A = '/api/v1/audits'

const t = useTestApi()
const { api, as, db } = t

/**
 * Bloqueo optimista (docs/06 §10): sin bloqueos de fila, cada escritura va con la versión que se leyó; si otra escritura
 * ganó la carrera, la BD ya subió la versión y esta no toca ninguna fila → 409 VERSION_CONFLICT.
 */
describe('bloqueo optimista', () => {
  it('editar una auditoría con una versión vieja es 409, no un 200 silencioso; la versión sube en cada escritura', async () => {
    const lib = await libraryFixture(db)
    const manager = await as('manager')
    const created = await api().post(A).set('authorization', manager).send(auditBody(lib))
    const { id, version } = created.body.data as { id: string; version: number }
    expect(version).toBe(0)

    const first = await api().patch(`${A}/${id}`).set('authorization', manager).send({ name: 'Primer cambio', version })
    expect(first.status).toBe(200)
    expect(first.body.data.version).toBe(1)

    // reintentar con la MISMA versión que ya se usó: la fila cambió entre medias
    const stale = await api()
      .patch(`${A}/${id}`)
      .set('authorization', manager)
      .send({ name: 'Segundo cambio', version })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { entity: 'Audit', id, expected: version },
    })
    expect((await db.audit.findUniqueOrThrow({ where: { id } })).name).toBe('Primer cambio') // no se pisó

    // con la versión correcta (la que devolvió la primera escritura) sí avanza
    const retried = await api()
      .patch(`${A}/${id}`)
      .set('authorization', manager)
      .send({ name: 'Segundo cambio', version: 1 })
    expect(retried.status).toBe(200)
    expect(retried.body.data).toMatchObject({ name: 'Segundo cambio', version: 2 })
  })

  it('dos ediciones concurrentes de la MISMA auditoría con la misma versión: una gana, la otra recibe VERSION_CONFLICT', async () => {
    const lib = await libraryFixture(db, '-c')
    const manager = await as('manager')
    const { id, version } = (await api().post(A).set('authorization', manager).send(auditBody(lib))).body.data
    const [a, b] = await Promise.all([
      api().patch(`${A}/${id}`).set('authorization', manager).send({ name: 'A', version }),
      api().patch(`${A}/${id}`).set('authorization', manager).send({ name: 'B', version }),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])
    const winner = a.status === 200 ? a.body.data.name : b.body.data.name
    expect((await db.audit.findUniqueOrThrow({ where: { id } })).name).toBe(winner)
  })

  it('editar el contenido de un criterio con una versión vieja es 409; con la correcta, avanza y sube la versión', async () => {
    const ctx = await startedAudit(t)
    // asignarlo (parte de `startedAudit`) ya subió la versión: se relee, no se asume 0.
    const roles = await db.evaluation.findFirstOrThrow({ where: { auditId: ctx.auditId, control: { title: 'Roles' } } })
    const v0 = roles.version
    const ana = await as('auditor', 'ana')
    const url = `${A}/${ctx.auditId}/evaluations/${roles.id}`

    const first = await api().patch(url).set('authorization', ana).send({ notes: 'primera nota', version: v0 })
    expect(first.status).toBe(200)
    expect(first.body.data.version).toBe(v0 + 1) // arrancó (NOT_STARTED → IN_PROGRESS) Y guardó: UNA sola escritura, una sola subida

    const stale = await api().patch(url).set('authorization', ana).send({ notes: 'pisando', version: v0 })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { entity: 'Evaluation', id: roles.id },
    })
    expect((await db.evaluation.findUniqueOrThrow({ where: { id: roles.id } })).notes).toBe('primera nota')

    const retried = await api()
      .patch(url)
      .set('authorization', ana)
      .send({ notes: 'segunda nota', version: v0 + 1 })
    expect(retried.status).toBe(200)
    expect(retried.body.data).toMatchObject({ notes: 'segunda nota', version: v0 + 2 })
  })

  it('sin campo `version` es 400: no hay forma de detectar el conflicto sin saber contra qué versión se edita', async () => {
    const lib = await libraryFixture(db, '-nv')
    const manager = await as('manager')
    const { id } = (await api().post(A).set('authorization', manager).send(auditBody(lib))).body.data
    const res = await api().patch(`${A}/${id}`).set('authorization', manager).send({ name: 'x' })
    expect(res.status).toBe(400)
  })

  it('otras escrituras sobre la auditoría (transferir) también suben la versión: una edición pendiente lo nota', async () => {
    const lib = await libraryFixture(db, '-t')
    const manager = await as('manager')
    const admin = await as('admin')
    const otherManager = await t.userId('manager', 'otro')
    const { id, version } = (await api().post(A).set('authorization', manager).send(auditBody(lib))).body.data
    const transferred = await api()
      .post(`${A}/${id}/transfer`)
      .set('authorization', admin)
      .send({ managerId: otherManager })
    expect(transferred.status).toBe(200)
    expect(transferred.body.data.version).toBeGreaterThan(version)

    const stale = await api()
      .patch(`${A}/${id}`)
      .set('authorization', await as('manager', 'otro'))
      .send({ name: 'x', version })
    expect(stale.status).toBe(409)
  })
})
