import { beforeEach, describe, expect, it } from 'vitest'
import { createAuditFixture, directDb, resetDb } from './support/db.js'

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

    const created = await db.organization.upsert({
      where: { name: 'UP' },
      create: { name: 'UP' },
      update: { isActive: false },
    })
    expect(created).toMatchObject({ createdById: U2, updatedById: U2 })
    currentUser = U1
    const updated = await db.organization.upsert({
      where: { name: 'UP' },
      create: { name: 'UP' },
      update: { isActive: false },
    })
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
    const scale = await db.scale.create({ data: { name: 'S' } })
    const level = await db.scaleLevel.create({ data: { scaleId: scale.id, value: 1, label: 'x' } })
    expect(level).not.toHaveProperty('createdById')
  })

  it('LÍMITE CONOCIDO: una escritura anidada no se sella (solo la operación de nivel superior)', async () => {
    currentUser = U1
    const org = await db.organization.create({ data: { name: 'A' } })
    const audit = await createAuditFixture(db, org.id)
    currentUser = U2
    // Audit y Report llevan sellos; el Report se crea ANIDADO dentro del update de la auditoría.
    await db.audit.update({
      where: { id: audit.id },
      data: { name: 'Renombrada', reports: { create: { title: 'Informe', storageFileId: 'nc-1' } } },
    })
    const parent = await db.audit.findUniqueOrThrow({ where: { id: audit.id } })
    const child = await db.report.findFirstOrThrow({ where: { auditId: audit.id } })
    expect(parent.updatedById).toBe(U2) // la operación de nivel superior sí se sella
    expect(child.createdById).toBeNull() // el hijo anidado NO
    // La forma correcta: crear el hijo con su propia llamada.
    const sealed = await db.report.create({ data: { auditId: audit.id, title: 'Otro', storageFileId: 'nc-2' } })
    expect(sealed.createdById).toBe(U2)
  })
})
