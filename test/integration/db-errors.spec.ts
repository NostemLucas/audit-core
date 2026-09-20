import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '../../src/platform/errors/index.js'
import { createAuditFixture, directDb, resetDb } from './support/db.js'

const db = directDb()
const MISSING = '00000000-0000-0000-0000-000000000000'

async function catchError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('se esperaba un error y la operación tuvo éxito')
}

beforeEach(() => resetDb(db))

describe('traducción de errores de la BD (Prisma 7 + adaptador pg, contra Postgres real)', () => {
  it('UNIQUE → el error que declaró esa restricción', async () => {
    await db.organization.create({ data: { name: 'ACME' } })
    const error = await catchError(db.organization.create({ data: { name: 'ACME' } }))
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'ORGANIZATION_NAME_TAKEN', http: 409 })
  })

  it('UNIQUE compuesto', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    await db.asset.create({ data: { organizationId: org.id, name: 'ERP' } })
    const error = await catchError(db.asset.create({ data: { organizationId: org.id, name: 'ERP' } }))
    expect(error).toMatchObject({ code: 'ASSET_NAME_TAKEN', http: 409 })
  })

  it('FK al BORRAR → el error de "en uso" (organización con activos)', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    await db.asset.create({ data: { organizationId: org.id, name: 'ERP' } })
    const error = await catchError(db.organization.delete({ where: { id: org.id } }))
    expect(error).toMatchObject({ code: 'ORGANIZATION_IN_USE', http: 409 })
  })

  it('FK al BORRAR → el MISMO error aunque Postgres reporte otra restricción (organización con auditorías)', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    await createAuditFixture(db, org.id)
    const error = await catchError(db.organization.delete({ where: { id: org.id } }))
    expect(error).toMatchObject({ code: 'ORGANIZATION_IN_USE' })
  })

  it('FK al ESCRIBIR → REFERENCE_INVALID (no "en uso")', async () => {
    const error = await catchError(db.asset.create({ data: { organizationId: MISSING, name: 'X' } }))
    expect(error).toMatchObject({ code: 'REFERENCE_INVALID', http: 422 })
  })

  it('registro inexistente en update → NOT_FOUND con el modelo', async () => {
    const error = await catchError(db.organization.update({ where: { id: MISSING }, data: { name: 'Z' } }))
    expect(error).toMatchObject({ code: 'NOT_FOUND', http: 404, details: { model: 'Organization' } })
  })

  it('CHECK de la BD → INTEGRITY_VIOLATION', async () => {
    const scale = await db.scale.create({ data: { code: 'S', name: 'S' } })
    const error = await catchError(
      db.scaleLevel.create({ data: { scaleId: scale.id, value: 1, label: 'x', description: 'd', color: 'rojo', position: 1 } }),
    )
    expect(error).toMatchObject({ code: 'INTEGRITY_VIOLATION', http: 422 })
  })

  it('un error no reconocido pasa sin traducir (acabará en INTERNAL)', async () => {
    const error = await catchError(db.organization.findUnique({ where: { id: 'no-es-un-uuid' } }))
    expect(error).not.toBeInstanceOf(DomainError)
  })

  it('el error traducido NO expone la restricción ni datos de la fila; solo queda en `cause` (log)', async () => {
    await db.organization.create({ data: { name: 'ACME-SECRETO' } })
    const error = (await catchError(db.organization.create({ data: { name: 'ACME-SECRETO' } }))) as DomainError
    expect(JSON.stringify({ code: error.code, message: error.message, details: error.details })).not.toMatch(/organizations_name_key|ACME-SECRETO/)
    expect(error.cause).toBeDefined()
  })
})
