import { beforeEach, describe, expect, it } from 'vitest'
import { directDb, resetDb } from './support/db.js'

const db = directDb()
beforeEach(() => resetDb(db))

describe('Organization: referencia del auditado, no un directorio de contactos', () => {
  it('guarda solo lo que el sistema usa (sin dirección, contactos ni descripción)', async () => {
    const org = await db.organization.create({ data: { name: 'Banco Ejemplo' } })
    expect(Object.keys(org).sort()).toEqual(['createdAt', 'createdById', 'id', 'isActive', 'name', 'updatedAt', 'updatedById'])
  })

  it('nace activa', async () => {
    const org = await db.organization.create({ data: { name: 'Banco Ejemplo' } })
    expect(org.isActive).toBe(true)
  })
})
