import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import {
  type Actor,
  type AuditAccess,
  assertCanEvaluate,
  assertOnAudit,
  canEvaluate,
  canOnAudit,
} from './audit-policy.js'

const actor = (id: string, ...roles: Actor['roles'][number][]): Actor => ({ id, roles })
const ADMIN = actor('admin', 'ADMIN')
const OWNER = actor('owner', 'GERENTE') // el manager de la auditoría
const OTHER_MANAGER = actor('other', 'GERENTE') // gerente, pero no el dueño
const LEAD = actor('lead', 'AUDITOR')
const INSPECTOR = actor('inspector', 'AUDITOR')
const OUTSIDER = actor('outsider', 'AUDITOR')

const access = (actorId: string): AuditAccess => ({
  managerId: 'owner',
  memberRole: actorId === 'lead' ? 'LEAD_AUDITOR' : actorId === 'inspector' ? 'INSPECTOR' : null,
})
const can = (action: 'read' | 'manage' | 'lead', who: Actor) => canOnAudit(action, who, access(who.id))

describe('tabla de docs/06 §1', () => {
  it('el ADMIN lo puede todo', () => {
    for (const action of ['read', 'manage', 'lead'] as const) expect(can(action, ADMIN)).toBe(true)
    expect(canEvaluate(ADMIN, access('admin'), 'alguien')).toBe(true)
  })

  it.each([
    ['el manager (dueño)', OWNER, { read: true, manage: true, lead: false }],
    ['otro GERENTE (no es el dueño)', OTHER_MANAGER, { read: true, manage: false, lead: false }],
    ['el líder', LEAD, { read: true, manage: false, lead: true }],
    ['un inspector', INSPECTOR, { read: true, manage: false, lead: false }],
    ['un auditor que no es miembro', OUTSIDER, { read: false, manage: false, lead: false }],
  ])('%s', (_quien, who, expected) => {
    expect({ read: can('read', who), manage: can('manage', who), lead: can('lead', who) }).toEqual(expected)
  })

  it('el manager NO es líder por serlo: para revisar o armar el equipo debe designarse líder', () => {
    expect(can('lead', OWNER)).toBe(false)
  })
})

describe('evaluar', () => {
  it('solo el inspector asignado a ese criterio', () => {
    expect(canEvaluate(INSPECTOR, access('inspector'), 'inspector')).toBe(true)
    expect(canEvaluate(INSPECTOR, access('inspector'), 'otro')).toBe(false)
    expect(canEvaluate(INSPECTOR, access('inspector'), null)).toBe(false)
  })

  it('el líder revisa, no evalúa: ni siquiera un criterio que tuviera asignado', () => {
    expect(canEvaluate(LEAD, access('lead'), 'lead')).toBe(false)
  })

  it('el manager y los ajenos no evalúan', () => {
    expect(canEvaluate(OWNER, access('owner'), 'owner')).toBe(false)
    expect(canEvaluate(OUTSIDER, access('outsider'), 'outsider')).toBe(false)
  })
})

describe('assert*', () => {
  it('lanza AUDIT_ACCESS_DENIED con el rol que hacía falta', () => {
    expect(() => assertOnAudit('manage', LEAD, access('lead'))).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'MANAGER' } }),
    )
    expect(() => assertOnAudit('lead', OWNER, access('owner'))).toThrow(
      expect.objectContaining({ details: { required: 'LEAD_AUDITOR' } }),
    )
    expect(() => assertOnAudit('read', OUTSIDER, access('outsider'))).toThrow(
      expect.objectContaining({ details: { required: 'MEMBER' } }),
    )
    expect(() => assertCanEvaluate(LEAD, access('lead'), 'lead')).toThrow(
      expect.objectContaining({ details: { required: 'ASSIGNED_INSPECTOR' } }),
    )
  })

  it('no lanza cuando está permitido', () => {
    expect(() => assertOnAudit('manage', OWNER, access('owner'))).not.toThrow()
    expect(() => assertCanEvaluate(INSPECTOR, access('inspector'), 'inspector')).not.toThrow()
  })
})
