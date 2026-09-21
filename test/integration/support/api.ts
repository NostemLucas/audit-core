import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { DB, type Db } from '../../../src/platform/db/index.js'
import { createTestIssuer } from '../../support/identity.js'
import { createTestApp } from './app.js'
import { resetDb } from './db.js'

/** Los grupos de Authentik de cada rol de prueba. `adminManager` es alguien con DOS roles globales (se suman). */
const GROUPS = {
  admin: ['admin'],
  manager: ['gerente'],
  auditor: ['auditor'],
  adminManager: ['admin', 'gerente'],
} as const
export type TestRole = keyof typeof GROUPS

/**
 * Arranque común de los tests HTTP contra Postgres real: la app completa, un emisor de tokens de prueba y la BD
 * vaciada antes de cada test. Llamar UNA vez en el nivel superior del archivo.
 */
export function useTestApi() {
  let app: NestExpressApplication
  let db: Db
  let issuer: Awaited<ReturnType<typeof createTestIssuer>>

  beforeAll(async () => {
    issuer = await createTestIssuer()
    app = await createTestApp({ jwtKeys: issuer.keys })
    db = app.get<Db>(DB)
  })
  afterAll(() => app.close())
  beforeEach(() => resetDb(db))

  // `db` existe recién tras `beforeAll`; el proxy deja usarlo directamente en los tests (`t.db.organization…`).
  const lazyDb = new Proxy({} as Db, { get: (_target, key) => Reflect.get(db, key) })

  return {
    app: () => app,
    db: lazyDb,
    /** Una petición HTTP a la app. */
    api: () => request(app.getHttpServer()),
    /**
     * El encabezado `authorization` de un usuario con ese rol. Cada rol es un usuario distinto; `who` distingue a varios
     * usuarios con el mismo rol (`as('manager', 'otro')` es otro gerente).
     */
    async as(role: TestRole, who: string = role): Promise<string> {
      const token = await issuer.sign({
        subject: `sub-${who}`,
        claims: { email: `${who}@ejemplo.com`, preferred_username: who, name: who, groups: [...GROUPS[role]] },
      })
      return `Bearer ${token}`
    },
    /** El id local de un usuario (lo crea si aún no ha entrado: el primer login lo sincroniza). */
    async userId(role: TestRole, who: string = role): Promise<string> {
      const token = await issuer.sign({
        subject: `sub-${who}`,
        claims: { email: `${who}@ejemplo.com`, preferred_username: who, name: who, groups: [...GROUPS[role]] },
      })
      await request(app.getHttpServer()).get('/api/v1/profile').set('authorization', `Bearer ${token}`).expect(200)
      return (await db.user.findUniqueOrThrow({ where: { authentikId: `sub-${who}` } })).id
    },
  }
}
