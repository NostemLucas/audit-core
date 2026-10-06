import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Un controlador = un corte vertical = un tier (docs/02 §4: A-Dominio, B-CRUD, C-Lectura). El tag
 * `(Tier X, docs/02 §4)` en el comentario justo antes de la clase es la fuente que puede leer un humano Y este
 * test — nunca solo la tabla de docs/02, que se desalineó de lo que `audits` construyó de verdad sin que nada lo
 * avisara (fase-5k: describía un repositorio + mapper que nunca existió). El mapa de abajo es la referencia: si
 * alguien cambia el tier de un corte sin venir a actualizarlo aquí, o agrega un controlador sin tag, el CI falla.
 */
const EXPECTED_TIERS: Readonly<Record<string, 'A' | 'B' | 'C'>> = {
  'src/modules/audits/lifecycle/audits.controller.ts': 'A',
  'src/modules/audits/evaluation/evaluations.controller.ts': 'A',
  'src/modules/audits/evidence/evidence.controller.ts': 'B',
  'src/modules/audits/evidence/nextcloud-webhook.controller.ts': 'B',
  'src/modules/audits/history/history.controller.ts': 'C',
  'src/modules/audits/files/audit-files.controller.ts': 'C',
  'src/modules/audits/reports/reports.controller.ts': 'B',
  'src/modules/audits/reports/report-templates.controller.ts': 'B',
  'src/modules/audits/results/results.controller.ts': 'C',
  'src/modules/audits/scope/scope.controller.ts': 'B',
  'src/modules/audits/team/team.controller.ts': 'B',
  'src/modules/dashboard/dashboard.controller.ts': 'C',
  'src/modules/identity/profile.controller.ts': 'B',
  'src/modules/identity/users.controller.ts': 'B',
  'src/modules/library/scales/scales.controller.ts': 'B',
  'src/modules/library/templates/controls.controller.ts': 'A',
  'src/modules/library/templates/suggested-findings.controller.ts': 'A',
  'src/modules/library/templates/templates.controller.ts': 'A',
  'src/modules/organizations/organizations.controller.ts': 'B',
}

const TIER_TAG = /\(Tier ([ABC]), docs\/02 §4/

function findControllers(dir: string, root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findControllers(full, root))
    else if (entry.name.endsWith('.controller.ts')) found.push(relative(root, full))
  }
  return found
}

describe('tiers de arquitectura (docs/02 §4)', () => {
  const root = join(import.meta.dirname, '..')
  const controllers = findControllers(join(root, 'src', 'modules'), root)

  it('hay al menos un controlador (que el recorrido de archivos no se rompió en silencio)', () => {
    expect(controllers.length).toBeGreaterThan(0)
  })

  it.each(controllers)('%s declara su tier, y coincide con el mapa esperado', (path) => {
    const expected = EXPECTED_TIERS[path]
    expect(expected, `${path} no está en EXPECTED_TIERS — agrégalo con su tier`).toBeDefined()
    const content = readFileSync(join(root, path), 'utf8')
    const match = content.match(TIER_TAG)
    expect(match, `${path}: falta el comentario "(Tier ${expected}, docs/02 §4)"`).not.toBeNull()
    expect(match![1], `${path}: el tier declarado no coincide con EXPECTED_TIERS`).toBe(expected)
  })

  it('el mapa no tiene entradas de controladores que ya no existen (archivo borrado o renombrado)', () => {
    for (const path of Object.keys(EXPECTED_TIERS)) {
      expect(controllers, `${path} está en EXPECTED_TIERS pero no existe`).toContain(path)
    }
  })
})
