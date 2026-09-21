import { expect } from 'vitest'
import type { useTestApi } from './api.js'
import { auditBody, type LibraryFixture, libraryFixture } from './audits.js'

const A = '/api/v1/audits'

export interface StartedAudit {
  auditId: string
  lib: LibraryFixture
  ana: string
  luis: string
  lead: string
}

/**
 * Una auditoría EN CURSO: manager, líder 'lider', auditores 'ana' y 'luis', todos los criterios asignados a ana. En MATURITY
 * el líder fija «Parcial» como esperado en todos (en CONFORMITY ya viene «Cumple» solo).
 */
export async function startedAudit(
  t: ReturnType<typeof useTestApi>,
  dimension: 'CONFORMITY' | 'MATURITY' = 'CONFORMITY',
  suffix = '',
): Promise<StartedAudit> {
  const { api, as, db } = t
  const lib = await libraryFixture(db, suffix, dimension)
  const manager = await as('manager')
  const auditId = (await api().post(A).set('authorization', manager).send(auditBody(lib))).body.data.id as string
  const [ana, luis, lead] = await Promise.all([
    t.userId('auditor', 'ana'),
    t.userId('auditor', 'luis'),
    t.userId('auditor', 'lider'),
  ])
  for (const [userId, role] of [
    [lead, 'LEAD'],
    [ana, 'MEMBER'],
    [luis, 'MEMBER'],
  ] as const) {
    await api().post(`${A}/${auditId}/members`).set('authorization', manager).send({ userId, role })
  }
  const ids = (await db.evaluation.findMany({ where: { auditId }, select: { id: true } })).map((e) => e.id)
  await api()
    .put(`${A}/${auditId}/assignments`)
    .set('authorization', await as('auditor', 'lider'))
    .send({ evaluationIds: ids, userId: ana })
  if (dimension === 'MATURITY') {
    const mid = lib.scale.levels.find((l) => l.label === 'Parcial')!
    await api()
      .put(`${A}/${auditId}/expected-levels`)
      .set('authorization', await as('auditor', 'lider'))
      .send({ evaluationIds: ids, expectedLevelId: mid.id })
  }
  const started = await api().post(`${A}/${auditId}/start`).set('authorization', manager)
  expect(started.status).toBe(200)
  return { auditId, lib, ana, luis, lead }
}
