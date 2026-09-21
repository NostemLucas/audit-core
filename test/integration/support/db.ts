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

/** Vacía todas las tablas de negocio (y reinicia la secuencia de códigos) entre tests. */
export async function resetDb(db: Db): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
  // La secuencia del código de auditoría no pertenece a ninguna tabla: TRUNCATE ... RESTART IDENTITY no la reinicia.
  await db.$executeRawUnsafe('ALTER SEQUENCE "audit_code_seq" RESTART WITH 1')
}

/** Lo mínimo para poder crear una auditoría. */
export async function createAuditFixture(db: Db, organizationId: string, code = 'AUD-TEST-1', scaleId?: string) {
  const user = await db.user.create({
    data: {
      authentikId: `ak-${code}`,
      email: `${code}@x.com`.toLowerCase(),
      username: code.toLowerCase(),
      name: 'A B',
    },
  })
  const template = await db.template.create({ data: { name: `T-${code}` } })
  const scale = scaleId
    ? { id: scaleId }
    : await db.scale.create({ data: { name: `S-${code}`, dimension: 'MATURITY' } })
  return db.audit.create({
    data: { code, name: 'Auditoría', templateId: template.id, organizationId, scaleId: scale.id, managerId: user.id },
  })
}
