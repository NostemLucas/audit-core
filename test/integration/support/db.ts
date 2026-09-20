import { inject } from 'vitest'
import { createDb, type Db } from '../../../src/platform/db/index.js'
import '../../../src/app-errors.js' // el traductor necesita el catálogo cargado

export function databaseUrl(): string {
  return inject('databaseUrl')
}

/** Cliente directo (sin Nest). `getUserId` simula al usuario de la petición. */
export function directDb(getUserId: () => string | undefined = () => undefined): Db {
  return createDb(databaseUrl(), getUserId)
}

/** Vacía todas las tablas de negocio entre tests. */
export async function resetDb(db: Db): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
}

/** Lo mínimo para poder crear una auditoría. */
export async function createAuditFixture(db: Db, organizationId: string, code = 'AUD-TEST-1') {
  const user = await db.user.create({
    data: { authentikId: `ak-${code}`, email: `${code}@x.com`.toLowerCase(), username: code.toLowerCase(), names: 'A', lastNames: 'B' },
  })
  const template = await db.template.create({ data: { name: `T-${code}` } })
  const scale = await db.scale.create({ data: { code: `S-${code}`, name: `S-${code}` } })
  return db.audit.create({
    data: { code, name: 'Auditoría', templateId: template.id, organizationId, scaleId: scale.id, managerId: user.id },
  })
}
