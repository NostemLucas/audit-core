import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { DB, type Db } from '../../../src/platform/db/index.js'
import { FakeFileStorage, type FileStoragePort } from '../../../src/platform/nextcloud/index.js'
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
export function useTestApi<S extends FileStoragePort = FakeFileStorage>(options: { fileStorage?: S } = {}) {
  let app: NestExpressApplication
  let db: Db
  let issuer: Awaited<ReturnType<typeof createTestIssuer>>
  const fileStorage = (options.fileStorage ?? new FakeFileStorage()) as S

  beforeAll(async () => {
    issuer = await createTestIssuer()
    app = await createTestApp({ jwtKeys: issuer.keys, fileStorage })
    db = app.get<Db>(DB)
  })
  afterAll(() => app.close())
  beforeEach(() => resetDb(db))
  // `resetDb` vacía la BD; el `FakeFileStorage` por defecto recuerda entre tests por su cuenta (docs/07 §3).
  beforeEach(() => (fileStorage as unknown as { reset?: () => void }).reset?.())

  // `db` existe recién tras `beforeAll`; el proxy deja usarlo directamente en los tests (`t.db.organization…`).
  const lazyDb = new Proxy({} as Db, { get: (_target, key) => Reflect.get(db, key) })

  return {
    app: () => app,
    db: lazyDb,
    /** El almacenamiento de archivos (`FakeFileStorage` por defecto: sin red real en los tests). */
    storage: fileStorage,
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
