import { createMongoAbility } from '@casl/ability'
import { packRules, unpackRules } from '@casl/ability/extra'
import { describe, expect, it } from 'vitest'
import type { Role } from '../../shared/enums.js'
import { ACTIONS, SUBJECTS, defineAbilityFor, type Action, type Subject } from './abilities.js'

const can = (roles: Role[], action: Action, subject: Subject) => defineAbilityFor(roles).can(action, subject)

describe('permisos globales por rol', () => {
  it('ADMIN puede todo', () => {
    for (const action of ACTIONS) for (const subject of SUBJECTS) expect(can(['ADMIN'], action, subject), `${action} ${subject}`).toBe(true)
  })

  it('GERENTE gestiona auditorías, biblioteca y organizaciones; solo lee usuarios y dashboard', () => {
    for (const subject of ['Audit', 'AuditMember', 'Evaluation', 'Evidence', 'Report', 'Template', 'Scale', 'Organization'] as const) {
      for (const action of ACTIONS) expect(can(['GERENTE'], action, subject), `${action} ${subject}`).toBe(true)
    }
    expect(can(['GERENTE'], 'read', 'User')).toBe(true)
    expect(can(['GERENTE'], 'read', 'Dashboard')).toBe(true)
    expect(can(['GERENTE'], 'update', 'User')).toBe(false)
    expect(can(['GERENTE'], 'create', 'User')).toBe(false)
    expect(can(['GERENTE'], 'delete', 'Dashboard')).toBe(false)
  })

  it('AUDITOR lee auditorías, equipo, informes, biblioteca y dashboard', () => {
    for (const subject of ['Audit', 'AuditMember', 'Report', 'Template', 'Scale', 'Dashboard'] as const) {
      expect(can(['AUDITOR'], 'read', subject), `read ${subject}`).toBe(true)
    }
  })

  it('AUDITOR trabaja evaluaciones y evidencias; solo la evidencia se puede borrar', () => {
    for (const action of ['create', 'read', 'update'] as const) {
      expect(can(['AUDITOR'], action, 'Evaluation')).toBe(true)
      expect(can(['AUDITOR'], action, 'Evidence')).toBe(true)
    }
    expect(can(['AUDITOR'], 'delete', 'Evidence')).toBe(true)
    expect(can(['AUDITOR'], 'delete', 'Evaluation')).toBe(false)
  })

  it('AUDITOR no puede administrar la biblioteca, las organizaciones ni las auditorías', () => {
    for (const action of ['create', 'update', 'delete'] as const) {
      expect(can(['AUDITOR'], action, 'Template')).toBe(false)
      expect(can(['AUDITOR'], action, 'Scale')).toBe(false)
      expect(can(['AUDITOR'], action, 'Organization')).toBe(false)
      expect(can(['AUDITOR'], action, 'Audit')).toBe(false)
    }
    expect(can(['AUDITOR'], 'read', 'Organization')).toBe(false)
    expect(can(['AUDITOR'], 'read', 'User')).toBe(false)
  })

  it('el equipo de la auditoría: el AUDITOR tiene el permiso grueso; quién puede en ESTA auditoría lo decide la policy contextual', () => {
    for (const action of ['create', 'update', 'delete'] as const) expect(can(['AUDITOR'], action, 'AuditMember')).toBe(true)
  })

  it('sin roles no se puede nada', () => {
    for (const action of ACTIONS) for (const subject of SUBJECTS) expect(can([], action, subject), `${action} ${subject}`).toBe(false)
  })

  it('varios roles suman permisos', () => {
    expect(can(['AUDITOR', 'GERENTE'], 'create', 'Template')).toBe(true)
    expect(can(['AUDITOR', 'GERENTE'], 'delete', 'Evidence')).toBe(true)
    expect(can(['AUDITOR'], 'create', 'Template')).toBe(false)
  })
})

describe('contrato con el frontend: reglas empaquetadas', () => {
  it.each([[['ADMIN']], [['GERENTE']], [['AUDITOR']], [['AUDITOR', 'GERENTE']], [[]]] as Array<[Role[]]>)(
    'las reglas de %j sobreviven a packRules → unpackRules con exactamente los mismos permisos',
    (roles) => {
      const backend = defineAbilityFor(roles)
      const frontend = createMongoAbility(unpackRules(packRules(backend.rules)))
      for (const action of ACTIONS) for (const subject of SUBJECTS) expect(frontend.can(action, subject), `${roles.join('+')}: ${action} ${subject}`).toBe(backend.can(action, subject))
    },
  )

  it('las reglas empaquetadas son JSON puro (viajan por la API)', () => {
    const packed = packRules(defineAbilityFor(['GERENTE']).rules)
    expect(JSON.parse(JSON.stringify(packed))).toEqual(packed)
  })
})
