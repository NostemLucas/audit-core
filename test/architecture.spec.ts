import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Reglas de dependencias que hoy se comprueban con este test y, cuando llegue `dependency-cruiser`, con él.
 * Se lee el código fuente: cada regla dice QUÉ no puede importar cada carpeta y POR QUÉ.
 */
const SRC = join(import.meta.dirname, '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8')
  return [...code.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

function violations(folder: string, forbidden: RegExp): string[] {
  return sourceFiles(join(SRC, folder)).flatMap((file) =>
    importsOf(file)
      .filter((spec) => forbidden.test(spec))
      .map((spec) => `${relative(SRC, file)} importa "${spec}"`),
  )
}

const HTTP_LIKE = /(^express$|platform-express|\/http\/|^helmet$|supertest)/

describe('arquitectura: logging y HTTP son contextos distintos', () => {
  it('platform/logging NO conoce HTTP (ni Express ni platform/http)', () => {
    expect(violations('platform/logging', HTTP_LIKE)).toEqual([])
  })

  it('platform/context (el contexto ambiental) NO conoce HTTP', () => {
    expect(violations('platform/context', HTTP_LIKE)).toEqual([])
  })

  it('platform/events y platform/db NO conocen HTTP', () => {
    expect(violations('platform/events', HTTP_LIKE)).toEqual([])
    expect(violations('platform/db', HTTP_LIKE)).toEqual([])
  })

  it('platform/logging solo depende del contexto ambiental, no de módulos de negocio', () => {
    expect(violations('platform/logging', /\/modules\//)).toEqual([])
  })

  it('platform/http SÍ puede usar el logger (la dependencia va en ese sentido)', () => {
    const usesLogger = sourceFiles(join(SRC, 'platform/http')).some((f) =>
      importsOf(f).some((s) => s.includes('/logging/')),
    )
    expect(usesLogger).toBe(true)
  })
})

describe('arquitectura: el dominio es puro', () => {
  const domainFiles = () => sourceFiles(join(SRC, 'modules')).filter((f) => f.includes('/domain/'))

  it('domain/ no importa Nest, Prisma, Express ni el logger', () => {
    const bad = domainFiles().flatMap((file) =>
      importsOf(file)
        .filter((spec) => /^@nestjs\/|^express$|generated\/prisma|\/logging\/|^pino$/.test(spec))
        .map((spec) => `${relative(SRC, file)} importa "${spec}"`),
    )
    expect(bad).toEqual([])
  })
})
