import { describe, expect, it } from 'vitest'
import { rolesFromGroups } from './roles-from-groups.js'

describe('rolesFromGroups (convención de nombres de los grupos de Authentik)', () => {
  it.each([
    [['admin'], ['ADMIN']],
    [['Administradores'], ['ADMIN']],
    [['gerente'], ['GERENTE']],
    [['Gerentes de Auditoría'], ['GERENTE']],
    [['manager'], ['GERENTE']],
    [['Managers'], ['GERENTE']],
    [['auditor'], ['AUDITOR']],
    [['Auditores Internos'], ['AUDITOR']],
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
    expect(rolesFromGroups(['admin', 'administradores', 'Admin-TI'])).toEqual(['ADMIN'])
  })

  it('cada grupo aporta a lo sumo UN rol, por orden de precedencia (admin gana)', () => {
    expect(rolesFromGroups(['auditor-admin'])).toEqual(['ADMIN'])
  })

  it('sin grupos, o con grupos no reconocidos, no hay roles', () => {
    expect(rolesFromGroups([])).toEqual([])
    expect(rolesFromGroups(['ventas', 'ti', 'authentik'])).toEqual([])
  })

  it('no distingue mayúsculas', () => {
    expect(rolesFromGroups(['ADMIN', 'GeReNtE'])).toEqual(['ADMIN', 'GERENTE'])
  })
})
