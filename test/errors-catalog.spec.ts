import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineErrors, errorRegistry } from '../src/platform/errors/index.js'
import '../src/app-errors.js'

/** Nombres de restricciones reales, leídos de las migraciones (la fuente de verdad de la BD). */
function loadConstraints() {
  const dir = join(import.meta.dirname, '..', 'prisma', 'migrations')
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

/**
 * UNIQUE de la migración que a propósito NO tienen error propio. Cada excepción lleva su razón; un UNIQUE nuevo
 * sin error ni excepción rompe el CI, para que alguien decida qué le pasa al usuario cuando choca.
 * (Un choque no mapeado igual llega al cliente como CONFLICT 409, nunca como 500.)
 */
const UNMAPPED_UNIQUES: Readonly<Record<string, string>> = {
  controls_id_templateId_key: 'destino de la FK compuesta del árbol; incluye el id, no puede colisionar',
  audits_code_key: 'el código sale de la secuencia audit_code_seq; un choque es un bug, no un caso de usuario',
  evaluations_auditId_controlId_key: 'las evaluaciones las crea el inicializador de la auditoría; un choque es un bug',
  suggested_findings_controlId_levelId_key: 'siempre se escribe con upsert; un choque es un bug',
  reports_storageFileId_key: 'el archivo lo genera y sube el propio sistema; un choque es un bug',
  report_templates_type_dimension_key:
    'operación de administración, muy poco frecuente; una carrera real (dos subidas a la vez para el mismo tipo) cae como 409 genérico, no 500',
  report_templates_one_wildcard: 'mismo caso que report_templates_type_dimension_key, para el comodín (dimension null)',
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
        NUEVO_B: { http: 409, message: 'y', onUnique: 'organizations_name_lower_key' },
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
    expect(errorRegistry.byForeignKeyDelete('audits_organizationId_fkey')?.code).toBe('ORGANIZATION_IN_USE')
    expect(errorRegistry.byUnique('organizations_name_lower_key')?.code).toBe('ORGANIZATION_NAME_TAKEN')
  })

  it('todo UNIQUE de la migración tiene un error asignado o una excepción justificada', () => {
    const mapped = new Set(errorRegistry.referencedConstraints().unique)
    const missing = [...loadConstraints().unique].filter((name) => !mapped.has(name) && !(name in UNMAPPED_UNIQUES))
    expect(
      missing,
      'UNIQUE sin error ni excepción: agrega onUnique a un error o justifícalo en UNMAPPED_UNIQUES',
    ).toEqual([])
  })

  it('las excepciones de UNIQUE no quedaron obsoletas', () => {
    const real = loadConstraints().unique
    const mapped = new Set(errorRegistry.referencedConstraints().unique)
    for (const name of Object.keys(UNMAPPED_UNIQUES)) {
      expect(real, `${name} ya no existe en la migración`).toContain(name)
      expect(mapped.has(name), `${name} ya tiene error: quítalo de UNMAPPED_UNIQUES`).toBe(false)
    }
  })
})
