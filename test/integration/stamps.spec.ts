import { beforeEach, describe, expect, it } from 'vitest'
import { directDb, resetDb } from './support/db.js'

const U1 = '00000000-0000-7000-8000-0000000000a1'
const U2 = '00000000-0000-7000-8000-0000000000a2'
let currentUser: string | undefined
const db = directDb(() => currentUser)

beforeEach(async () => {
  currentUser = undefined
  await resetDb(db)
})

describe('sellos createdById / updatedById (extensión de Prisma)', () => {
  it('create: sella creador y editor con el usuario de la petición', async () => {
    currentUser = U1
    const org = await db.organization.create({ data: { name: 'A' } })
    expect(org).toMatchObject({ createdById: U1, updatedById: U1 })
  })

  it('update: cambia solo el editor y conserva al creador', async () => {
    currentUser = U1
    const org = await db.organization.create({ data: { name: 'A' } })
    currentUser = U2
    const updated = await db.organization.update({ where: { id: org.id }, data: { name: 'B' } })
    expect(updated).toMatchObject({ createdById: U1, updatedById: U2 })
  })

  it('createMany / createManyAndReturn / updateMany / upsert', async () => {
    currentUser = U1
    await db.organization.createMany({ data: [{ name: 'M1' }, { name: 'M2' }] })
    const returned = await db.organization.createManyAndReturn({ data: [{ name: 'M3' }] })
    expect(returned[0]).toMatchObject({ createdById: U1, updatedById: U1 })

    currentUser = U2
    await db.organization.updateMany({ where: { name: { in: ['M1', 'M2'] } }, data: { isActive: false } })
    const rows = await db.organization.findMany({ where: { name: { in: ['M1', 'M2'] } } })
    expect(rows.every((r) => r.createdById === U1 && r.updatedById === U2)).toBe(true)

    const created = await db.organization.upsert({ where: { name: 'UP' }, create: { name: 'UP' }, update: { isActive: false } })
    expect(created).toMatchObject({ createdById: U2, updatedById: U2 })
    currentUser = U1
    const updated = await db.organization.upsert({ where: { name: 'UP' }, create: { name: 'UP' }, update: { isActive: false } })
    expect(updated).toMatchObject({ createdById: U2, updatedById: U1 })
  })

  it('sin usuario (seeds, jobs) quedan en null; un update sin usuario limpia al editor', async () => {
    const org = await db.organization.create({ data: { name: 'A' } })
    expect(org).toMatchObject({ createdById: null, updatedById: null })
    currentUser = U1
    await db.organization.update({ where: { id: org.id }, data: { name: 'B' } })
    currentUser = undefined
    const after = await db.organization.update({ where: { id: org.id }, data: { name: 'C' } })
    expect(after.updatedById).toBeNull()
  })

  it('un valor explícito del llamador gana', async () => {
    currentUser = U1
    const org = await db.organization.create({ data: { name: 'A', createdById: U2 } })
    expect(org).toMatchObject({ createdById: U2, updatedById: U1 })
  })

  it('un modelo sin sellos (ScaleLevel) funciona igual, sin errores', async () => {
    currentUser = U1
    const scale = await db.scale.create({ data: { code: 'S', name: 'S' } })
    const level = await db.scaleLevel.create({ data: { scaleId: scale.id, value: 1, label: 'x', description: 'd', color: '#00FF00', position: 1 } })
    expect(level).not.toHaveProperty('createdById')
  })

  it('LÍMITE CONOCIDO: una escritura anidada no se sella (solo la operación de nivel superior)', async () => {
    currentUser = U1
    const org = await db.organization.create({ data: { name: 'A', assets: { create: { name: 'ERP' } } } })
    const asset = await db.asset.findFirstOrThrow({ where: { organizationId: org.id } })
    expect(org.createdById).toBe(U1)
    expect(asset.createdById).toBeNull()
  })
})
