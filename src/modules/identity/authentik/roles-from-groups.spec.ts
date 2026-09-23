import { describe, expect, it } from 'vitest'
import { rolesFromGroups } from './roles-from-groups.js'

describe('rolesFromGroups (convención de nombres de los grupos de Authentik)', () => {
  it.each([
    [['admin'], ['ADMIN']],
    [['gerente'], ['GERENTE']],
    [['auditor'], ['AUDITOR']],
  ])('%j → %j', (groups, roles) => {
    expect(rolesFromGroups(groups)).toEqual(roles)
  })

  it('un usuario en varios grupos tiene varios roles', () => {
    expect(rolesFromGroups(['auditor', 'gerente'])).toEqual(['GERENTE', 'AUDITOR'])
  })

  it('el orden es fijo: dos sincronizaciones iguales dan exactamente el mismo resultado', () => {
    expect(rolesFromGroups(['auditor', 'admin', 'gerente'])).toEqual(['ADMIN', 'GERENTE', 'AUDITOR'])
    expect(rolesFromGroups(['admin', 'gerente', 'auditor'])).toEqual(['ADMIN', 'GERENTE', 'AUDITOR'])
  })

  it('no repite roles', () => {
    expect(rolesFromGroups(['admin', 'admin'])).toEqual(['ADMIN'])
  })

  it('exige coincidencia EXACTA: nombres parecidos o compuestos no matchean nada', () => {
    expect(rolesFromGroups(['Administradores'])).toEqual([])
    expect(rolesFromGroups(['authentik Admins'])).toEqual([])
    expect(rolesFromGroups(['Administración'])).toEqual([])
    expect(rolesFromGroups(['Account Managers'])).toEqual([])
    expect(rolesFromGroups(['Gerentes de Auditoría'])).toEqual([])
    expect(rolesFromGroups(['auditor-admin'])).toEqual([])
    expect(rolesFromGroups(['manager'])).toEqual([])
  })

  it('sin grupos, o con grupos no reconocidos, no hay roles', () => {
    expect(rolesFromGroups([])).toEqual([])
    expect(rolesFromGroups(['ventas', 'ti', 'authentik'])).toEqual([])
  })

  it('no distingue mayúsculas, pero sí exige el nombre completo', () => {
    expect(rolesFromGroups(['ADMIN', 'GeReNtE'])).toEqual(['ADMIN', 'GERENTE'])
  })
})
