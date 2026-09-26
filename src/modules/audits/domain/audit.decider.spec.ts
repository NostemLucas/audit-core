import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import type { Actor } from './audit-policy.js'
import { closeAudit, type AuditState, startAudit } from './audit.decider.js'

const MANAGER: Actor = { id: 'gerente', roles: ['GERENTE'] }
const OTHER: Actor = { id: 'otro', roles: ['GERENTE'] }

/** Una auditoría en borrador, lista para iniciar: hay líder, hay auditores, nadie sin nivel ni sin asignar. */
const draft = (over: Partial<AuditState> = {}): AuditState => ({
  auditId: 'audit-1',
  status: 'DRAFT',
  access: { managerId: MANAGER.id, memberRole: null },
  leadCount: 1,
  memberCount: 1,
  missingExpectedLevel: 0,
  unassignedEvaluations: 0,
  pendingEvaluations: 0,
  ...over,
})

describe('startAudit', () => {
  it('con todo listo: pasa a IN_PROGRESS y anuncia AuditStarted', () => {
    const decision = startAudit(draft(), MANAGER)
    expect(decision.to).toBe('IN_PROGRESS')
    expect(decision.lockTeamReports).toBeUndefined()
    expect(decision.event.def.name).toBe('AuditStarted')
    expect(decision.event.payload).toEqual({ auditId: 'audit-1' })
  })

  it('las comprobaciones van en orden: quién → ciclo de vida → líder → auditores → niveles → asignación', () => {
    const allWrong = draft({
      status: 'IN_PROGRESS',
      leadCount: 0,
      memberCount: 0,
      missingExpectedLevel: 2,
      unassignedEvaluations: 3,
    })
    // no es el manager: gana el permiso, aunque todo lo demás también esté mal
    expect(() => startAudit(allWrong, OTHER)).toThrow(expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }))
    // manager, pero ya no está en borrador: gana el ciclo de vida
    expect(() => startAudit(allWrong, MANAGER)).toThrow(expect.objectContaining({ code: 'AUDIT_INVALID_STATE' }))
    // en borrador: gana que no hay líder
    expect(() => startAudit({ ...allWrong, status: 'DRAFT' }, MANAGER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_HAS_NO_LEAD' }),
    )
    // con líder: gana que no hay auditores
    expect(() =>
      startAudit(draft({ memberCount: 0, missingExpectedLevel: 2, unassignedEvaluations: 3 }), MANAGER),
    ).toThrow(expect.objectContaining({ code: 'AUDIT_HAS_NO_MEMBERS' }))
    // con equipo: gana el nivel esperado que falta
    expect(() => startAudit(draft({ missingExpectedLevel: 2, unassignedEvaluations: 3 }), MANAGER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_EXPECTED_LEVELS_MISSING', details: { missing: 2 } }),
    )
    // con niveles: gana lo que falta asignar
    expect(() => startAudit(draft({ unassignedEvaluations: 3 }), MANAGER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_UNASSIGNED_EVALUATIONS', details: { missing: 3 } }),
    )
  })
})

describe('closeAudit', () => {
  const inProgress = (over: Partial<AuditState> = {}) => draft({ status: 'IN_PROGRESS', ...over })

  it('sin pendientes: pasa a CLOSED, anuncia AuditClosed y pide bajar los informes del equipo', () => {
    const decision = closeAudit(inProgress(), MANAGER)
    expect(decision.to).toBe('CLOSED')
    expect(decision.event.def.name).toBe('AuditClosed')
    expect(decision.lockTeamReports).toBe(true)
  })

  it('las comprobaciones van en orden: quién → ciclo de vida → pendientes', () => {
    expect(() => closeAudit(inProgress({ pendingEvaluations: 2 }), OTHER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }),
    )
    expect(() => closeAudit(draft({ pendingEvaluations: 2 }), MANAGER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_INVALID_STATE' }),
    )
    expect(() => closeAudit(inProgress({ pendingEvaluations: 2 }), MANAGER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_HAS_PENDING_EVALUATIONS', details: { pending: 2 } }),
    )
  })
})
