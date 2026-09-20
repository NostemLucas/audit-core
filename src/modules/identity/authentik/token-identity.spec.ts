import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../platform/errors/index.js'
import '../../../app-errors.js'
import { identityFromClaims } from './token-identity.js'

const base = {
  sub: 'sub-1',
  email: 'Ana.Perez@Ejemplo.com',
  preferred_username: 'Ana.Perez',
  name: 'Ana Pérez',
  groups: ['auditor'],
}

function failure(claims: Record<string, unknown>): DomainError {
  try {
    identityFromClaims({ sub: 'sub-1', ...claims })
  } catch (error) {
    return error as DomainError
  }
  throw new Error('se esperaba un error')
}

describe('identityFromClaims', () => {
  it('toma la identidad del token', () => {
    expect(identityFromClaims(base)).toEqual({
      authentikId: 'sub-1',
      email: 'ana.perez@ejemplo.com',
      username: 'Ana.Perez',
      name: 'Ana Pérez',
      roles: ['AUDITOR'],
      groups: ['auditor'],
    })
  })

  it('el email se normaliza a minúsculas', () => {
    expect(identityFromClaims(base).email).toBe('ana.perez@ejemplo.com')
  })

  it('el username se guarda TAL CUAL: es el usuario de Nextcloud y distingue mayúsculas', () => {
    expect(identityFromClaims({ ...base, preferred_username: 'Ana.PEREZ' }).username).toBe('Ana.PEREZ')
  })

  it('sin `name` cae al username', () => {
    expect(identityFromClaims({ ...base, name: undefined }).name).toBe('Ana.Perez')
    expect(identityFromClaims({ ...base, name: '   ' }).name).toBe('Ana.Perez')
  })

  it('sin preferred_username NO inventa uno (el proyecto anterior usaba email.split("@")[0]): rechaza', () => {
    const error = failure({ ...base, preferred_username: undefined })
    expect(error).toMatchObject({
      code: 'TOKEN_CLAIMS_MISSING',
      http: 401,
      details: { missing: ['preferred_username'] },
    })
  })

  it('sin email rechaza', () => {
    expect(failure({ ...base, email: undefined })).toMatchObject({
      code: 'TOKEN_CLAIMS_MISSING',
      details: { missing: ['email'] },
    })
  })

  it('lista TODOS los claims que faltan', () => {
    expect(failure({ name: 'X' })).toMatchObject({ details: { missing: ['email', 'preferred_username'] } })
  })

  it('un claim vacío o de otro tipo cuenta como ausente', () => {
    expect(failure({ ...base, email: '  ' })).toMatchObject({ details: { missing: ['email'] } })
    expect(failure({ ...base, preferred_username: 42 })).toMatchObject({ details: { missing: ['preferred_username'] } })
  })

  it('los grupos que no son texto se ignoran; sin grupos → sin roles', () => {
    expect(identityFromClaims({ ...base, groups: ['admin', 7, null] }).roles).toEqual(['ADMIN'])
    expect(identityFromClaims({ ...base, groups: undefined }).roles).toEqual([])
    expect(identityFromClaims({ ...base, groups: 'admin' }).roles).toEqual([])
  })

  it('es un DomainError del catálogo', () => {
    expect(failure({})).toBeInstanceOf(DomainError)
  })
})
