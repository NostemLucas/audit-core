import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '../../src/platform/errors/index.js'
import { createAuditFixture, directDb, resetDb } from './support/db.js'

const db = directDb()
beforeEach(() => resetDb(db))

async function user(name: string) {
  return db.user.create({ data: { authentikId: `sub-${name}`, email: `${name}@x.com`, username: name, name } })
}
async function catchError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('se esperaba un error')
}

describe('equipo de la auditoría: un solo líder, garantizado por la BD (docs/06 §1)', () => {
  it('un segundo LEAD en la misma auditoría es AUDIT_LEAD_ALREADY_ASSIGNED (409), sin bloqueos', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    await db.auditMember.create({ data: { auditId: audit.id, userId: (await user('ana')).id, role: 'LEAD' } })
    const error = await catchError(
      db.auditMember.create({ data: { auditId: audit.id, userId: (await user('luis')).id, role: 'LEAD' } }),
    )
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'AUDIT_LEAD_ALREADY_ASSIGNED', http: 409 })
    expect(await db.auditMember.count()).toBe(1)
  })

  it('varios MEMBER sí; y un LEAD por cada auditoría distinta', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const a = await createAuditFixture(db, org.id, 'AUD-A')
    const b = await createAuditFixture(db, org.id, 'AUD-B')
    const [ana, luis, eva] = [await user('ana'), await user('luis'), await user('eva')]
    await db.auditMember.createMany({
      data: [
        { auditId: a.id, userId: ana.id, role: 'LEAD' },
        { auditId: a.id, userId: luis.id }, // por defecto MEMBER
        { auditId: a.id, userId: eva.id, role: 'MEMBER' },
        { auditId: b.id, userId: ana.id, role: 'LEAD' },
      ],
    })
    expect((await db.auditMember.findMany({ where: { auditId: a.id, userId: luis.id } }))[0]!.role).toBe('MEMBER')
    expect(await db.auditMember.count({ where: { role: 'LEAD' } })).toBe(2)
  })

  it('cambiar de líder: quitar al actual y designar al nuevo funciona; designar sin quitar, no', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    const [ana, luis] = [await user('ana'), await user('luis')]
    const lead = await db.auditMember.create({ data: { auditId: audit.id, userId: ana.id, role: 'LEAD' } })
    const member = await db.auditMember.create({ data: { auditId: audit.id, userId: luis.id, role: 'MEMBER' } })
    expect(await catchError(db.auditMember.update({ where: { id: member.id }, data: { role: 'LEAD' } }))).toMatchObject(
      { code: 'AUDIT_LEAD_ALREADY_ASSIGNED' },
    )
    await db.auditMember.update({ where: { id: lead.id }, data: { role: 'MEMBER' } })
    await db.auditMember.update({ where: { id: member.id }, data: { role: 'LEAD' } })
    expect((await db.auditMember.findMany({ where: { role: 'LEAD' } })).map((m) => m.userId)).toEqual([luis.id])
  })

  it('designaciones simultáneas de líder: exactamente una gana y las demás son AUDIT_LEAD_ALREADY_ASSIGNED (nunca dos líderes)', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4', 'u5'].map(user))
    const results = await Promise.allSettled(
      users.map((u) => db.auditMember.create({ data: { auditId: audit.id, userId: u.id, role: 'LEAD' } })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results)
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'AUDIT_LEAD_ALREADY_ASSIGNED' })
    expect(await db.auditMember.count({ where: { role: 'LEAD' } })).toBe(1)
  })
})

describe('el modelo de revisión no guarda rondas ni una tabla aparte (docs/06 §4, §6)', () => {
  it('no existen la tabla evaluation_reviews ni la columna round', async () => {
    const tables = await db.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    expect(tables.map((t) => t.tablename)).not.toContain('evaluation_reviews')
    const columns = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('round', 'expectedLevelReason')`
    expect(columns).toEqual([])
  })
})
