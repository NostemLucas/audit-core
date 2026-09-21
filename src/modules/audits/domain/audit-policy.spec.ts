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
const ADMIN_MANAGER = actor('owner', 'ADMIN', 'GERENTE') // una persona con los dos roles que además dirige esta auditoría
const OWNER = actor('owner', 'GERENTE') // el manager de la auditoría
const OTHER_MANAGER = actor('other', 'GERENTE') // gerente, pero no el dueño
const LEAD = actor('lead', 'AUDITOR')
const MEMBER = actor('member', 'AUDITOR')
const OUTSIDER = actor('outsider', 'AUDITOR')

const access = (actorId: string): AuditAccess => ({
  managerId: 'owner',
  memberRole: actorId === 'lead' ? 'LEAD' : actorId === 'member' ? 'MEMBER' : null,
})
const can = (action: 'read' | 'manage' | 'lead', who: Actor) => canOnAudit(action, who, access(who.id))

describe('tabla de docs/06 §1', () => {
  it.each([
    ['el manager (dueño)', OWNER, { read: true, manage: true, lead: false }],
    ['otro GERENTE (no es el dueño)', OTHER_MANAGER, { read: true, manage: false, lead: false }],
    ['el líder', LEAD, { read: true, manage: false, lead: true }],
    ['un auditor del equipo', MEMBER, { read: true, manage: false, lead: false }],
    ['un auditor que no es miembro', OUTSIDER, { read: false, manage: false, lead: false }],
  ])('%s', (_quien, who, expected) => {
    expect({ read: can('read', who), manage: can('manage', who), lead: can('lead', who) }).toEqual(expected)
  })

  it('el ADMIN VE la auditoría pero no la gestiona ni la revisa: sin superusuario', () => {
    expect({ read: can('read', ADMIN), manage: can('manage', ADMIN), lead: can('lead', ADMIN) }).toEqual({
      read: true,
      manage: false,
      lead: false,
    })
    expect(canEvaluate(ADMIN, access('admin'), 'admin')).toBe(false)
  })

  it('quien es ADMIN y GERENTE gestiona la que dirige, pero COMO manager (no por ser ADMIN)', () => {
    expect(can('manage', ADMIN_MANAGER)).toBe(true)
    expect(canOnAudit('manage', ADMIN_MANAGER, { managerId: 'otra-persona', memberRole: null })).toBe(false)
  })

  it('el manager NO es líder por serlo: para revisar debe designarse líder', () => {
    expect(can('lead', OWNER)).toBe(false)
  })

  it('quien no es manager ni líder no puede gestionar ni revisar, sea cual sea su rol global', () => {
    expect(can('manage', LEAD)).toBe(false) // el líder no arma el equipo ni inicia ni cierra
    expect(can('lead', OTHER_MANAGER)).toBe(false)
  })
})

describe('evaluar', () => {
  it('solo el auditor asignado a ese criterio', () => {
    expect(canEvaluate(MEMBER, access('member'), 'member')).toBe(true)
    expect(canEvaluate(MEMBER, access('member'), 'otro')).toBe(false)
    expect(canEvaluate(MEMBER, access('member'), null)).toBe(false)
  })

  it('el líder revisa, no evalúa: ni siquiera un criterio que tuviera asignado (quien revisa no revisa lo suyo)', () => {
    expect(canEvaluate(LEAD, access('lead'), 'lead')).toBe(false)
  })

  it('el manager, el ADMIN y los ajenos no evalúan', () => {
    expect(canEvaluate(OWNER, access('owner'), 'owner')).toBe(false)
    expect(canEvaluate(ADMIN, access('admin'), 'admin')).toBe(false)
    expect(canEvaluate(OUTSIDER, access('outsider'), 'outsider')).toBe(false)
  })
})

describe('assert*', () => {
  it('lanza AUDIT_ACCESS_DENIED con el rol que hacía falta', () => {
    expect(() => assertOnAudit('manage', LEAD, access('lead'))).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED', details: { required: 'MANAGER' } }),
    )
    expect(() => assertOnAudit('manage', ADMIN, access('admin'))).toThrow(
      expect.objectContaining({ details: { required: 'MANAGER' } }),
    )
    expect(() => assertOnAudit('lead', OWNER, access('owner'))).toThrow(
      expect.objectContaining({ details: { required: 'LEAD' } }),
    )
    expect(() => assertOnAudit('read', OUTSIDER, access('outsider'))).toThrow(
      expect.objectContaining({ details: { required: 'MEMBER' } }),
    )
    expect(() => assertCanEvaluate(LEAD, access('lead'), 'lead')).toThrow(
      expect.objectContaining({ details: { required: 'ASSIGNED_MEMBER' } }),
    )
  })

  it('no lanza cuando está permitido', () => {
    expect(() => assertOnAudit('manage', OWNER, access('owner'))).not.toThrow()
    expect(() => assertOnAudit('read', ADMIN, access('admin'))).not.toThrow()
    expect(() => assertCanEvaluate(MEMBER, access('member'), 'member')).not.toThrow()
  })
})
