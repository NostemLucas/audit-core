import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '../../src/platform/errors/index.js'
import { directDb, resetDb } from './support/db.js'

const db = directDb()
const base = { authentikId: 'sub-1', email: 'ana@x.com', username: 'Ana.Perez', name: 'Ana Pérez' }

beforeEach(() => resetDb(db))

async function catchError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('se esperaba un error')
}

describe('User: espejo mínimo de Authentik', () => {
  it('guarda solo lo del proveedor: sin ci, phone, apellidos separados ni sellos', async () => {
    const user = await db.user.create({ data: base })
    expect(Object.keys(user).sort()).toEqual(['authentikId', 'createdAt', 'email', 'id', 'name', 'roles', 'updatedAt', 'username'])
  })

  it('el username se guarda TAL CUAL (es el usuario de Nextcloud y distingue mayúsculas)', async () => {
    const user = await db.user.create({ data: base })
    expect(user.username).toBe('Ana.Perez')
  })

  it('el email debe venir en minúsculas (lo garantiza la BD)', async () => {
    const error = await catchError(db.user.create({ data: { ...base, email: 'Ana@X.com' } }))
    expect(error).toMatchObject({ code: 'INTEGRITY_VIOLATION' })
  })

  it.each([
    ['authentikId', { authentikId: 'sub-1', email: 'otra@x.com', username: 'otra' }],
    ['email', { authentikId: 'sub-2', email: 'ana@x.com', username: 'otra' }],
    ['username', { authentikId: 'sub-2', email: 'otra@x.com', username: 'Ana.Perez' }],
  ])('un choque de %s es USER_IDENTITY_CONFLICT (lo que la sincronización atrapa para reintentar)', async (_campo, data) => {
    await db.user.create({ data: base })
    const error = await catchError(db.user.create({ data: { ...data, name: 'Otra' } }))
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'USER_IDENTITY_CONFLICT', http: 409 })
  })

  it('roles es un arreglo de enums, vacío por defecto', async () => {
    const user = await db.user.create({ data: base })
    expect(user.roles).toEqual([])
    const admin = await db.user.update({ where: { id: user.id }, data: { roles: ['ADMIN', 'AUDITOR'] } })
    expect(admin.roles).toEqual(['ADMIN', 'AUDITOR'])
  })
})
