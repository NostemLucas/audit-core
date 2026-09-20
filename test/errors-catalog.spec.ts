import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineErrors, errorRegistry } from '../src/platform/errors'
import '../src/app-errors'

/** Nombres de restricciones reales, leídos de las migraciones (la fuente de verdad de la BD). */
function loadConstraints() {
  const dir = join(__dirname, '..', 'prisma', 'migrations')
  const sql = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readFileSync(join(dir, d.name, 'migration.sql'), 'utf8'))
    .join('\n')
  const names = (re: RegExp) => new Set([...sql.matchAll(re)].map((m) => m[1]!))
  return {
    unique: names(/CREATE UNIQUE INDEX "([^"]+)"/g),
    foreignKey: names(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g),
  }
}

describe('catálogo de errores', () => {
  it('todos los códigos son MAYUSCULAS_CON_GUION_BAJO', () => {
    for (const def of errorRegistry.all()) expect(def.code).toMatch(/^[A-Z][A-Z0-9_]+$/)
  })

  it('cada error tiene mensaje y estado HTTP', () => {
    for (const def of errorRegistry.all()) {
      expect(def.message.length).toBeGreaterThan(0)
      expect(def.http).toBeGreaterThanOrEqual(400)
    }
  })

  it('rechaza códigos duplicados sin dejar el catálogo a medias', () => {
    const before = errorRegistry.all().length
    expect(() => defineErrors({ AUDIT_NOT_FOUND: { http: 404, message: 'x' } })).toThrow(/duplicado/)
    expect(() =>
      defineErrors({
        NUEVO_A: { http: 409, message: 'x' },
        NUEVO_B: { http: 409, message: 'y', onUnique: 'organizations_name_key' },
      }),
    ).toThrow(/ya está asignada/)
    expect(errorRegistry.all()).toHaveLength(before)
    expect(errorRegistry.byCode('NUEVO_A')).toBeUndefined()
  })

  it('cada restricción UNIQUE referenciada existe en la migración', () => {
    const real = loadConstraints().unique
    for (const name of errorRegistry.referencedConstraints().unique) expect(real, name).toContain(name)
  })

  it('cada restricción FK referenciada existe en la migración', () => {
    const real = loadConstraints().foreignKey
    for (const name of errorRegistry.referencedConstraints().foreignKey) expect(real, name).toContain(name)
  })

  it('traduce una FK de borrado al error del módulo dueño', () => {
    expect(errorRegistry.byForeignKeyDelete('assets_organizationId_fkey')?.code).toBe('ORGANIZATION_IN_USE')
    expect(errorRegistry.byForeignKeyDelete('audits_organizationId_fkey')?.code).toBe('ORGANIZATION_IN_USE')
    expect(errorRegistry.byUnique('organizations_name_key')?.code).toBe('ORGANIZATION_NAME_TAKEN')
  })
})
