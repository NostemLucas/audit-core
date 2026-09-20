/**
 * Catálogo de errores: cada módulo declara los suyos con `defineErrors` y ahí mismo dice qué restricción
 * de la BD se traduce a cada uno. Esa declaración es la ÚNICA fuente de: el código, el estado HTTP, el mensaje
 * y la traducción de errores de Prisma. Nada más lista códigos.
 *
 * Convención de estados HTTP
 *   400  petición mal formada (esquema Zod inválido)
 *   401  sin identidad válida
 *   403  identidad válida pero sin permiso (rol o membresía)
 *   404  el recurso no existe
 *   409  choque con el estado actual: duplicado, en uso, transición no permitida en este estado
 *   422  la petición es válida pero viola una regla de negocio
 *   429  demasiadas peticiones
 *   500  bug nuestro
 *   502/503  falla de un sistema externo (Nextcloud, Authentik)
 */

export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503

export interface ErrorSpec {
  readonly http: HttpStatus
  /** Mensaje por defecto (es). Los datos variables van en `details`, no interpolados aquí. */
  readonly message: string
  /**
   * Restricciones UNIQUE (nombre del índice en Postgres) que se traducen a este error
   * cuando fallan en un create/update.
   */
  readonly onUnique?: string | readonly string[]
  /**
   * Restricciones FK que se traducen a este error cuando fallan en un DELETE (onDelete: Restrict).
   * Solo aplica a borrados: un fallo de FK al insertar/actualizar significa "referencia inválida" y lo valida
   * el dominio con un error específico (Postgres informa la primera FK que falla, no la más relevante).
   * Un mismo error puede agrupar varias FK: p. ej. una organización se bloquea por auditorías O por activos.
   */
  readonly onForeignKeyDelete?: string | readonly string[]
}

export interface ErrorDef<C extends string = string> extends ErrorSpec {
  readonly code: C
}

const byCode = new Map<string, ErrorDef>()
const byUnique = new Map<string, ErrorDef>()
const byForeignKeyDelete = new Map<string, ErrorDef>()

function toList(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  return typeof value === 'string' ? [value] : value
}

function assertFree(map: Map<string, ErrorDef>, kind: string, name: string, code: string): void {
  const existing = map.get(name)
  if (existing) {
    throw new Error(`Restricción ${kind} "${name}" ya está asignada a ${existing.code}; no puede asignarse también a ${code}`)
  }
}

export function defineErrors<const T extends Record<string, ErrorSpec>>(
  specs: T,
): { readonly [K in keyof T & string]: ErrorDef<K> } {
  const defs: ErrorDef[] = Object.entries(specs).map(([code, spec]) => ({ code, ...spec }))

  // Se valida TODO antes de registrar nada: un fallo no deja el catálogo a medias.
  const seen = new Set<string>()
  for (const def of defs) {
    if (byCode.has(def.code) || seen.has(def.code)) throw new Error(`Código de error duplicado: ${def.code}`)
    seen.add(def.code)
    for (const name of toList(def.onUnique)) assertFree(byUnique, 'UNIQUE', name, def.code)
    for (const name of toList(def.onForeignKeyDelete)) assertFree(byForeignKeyDelete, 'FK', name, def.code)
  }

  const result: Record<string, ErrorDef> = {}
  for (const def of defs) {
    byCode.set(def.code, def)
    for (const name of toList(def.onUnique)) byUnique.set(name, def)
    for (const name of toList(def.onForeignKeyDelete)) byForeignKeyDelete.set(name, def)
    result[def.code] = def
  }
  return result as { readonly [K in keyof T & string]: ErrorDef<K> }
}

export const errorRegistry = {
  all: (): readonly ErrorDef[] => [...byCode.values()],
  byCode: (code: string): ErrorDef | undefined => byCode.get(code),
  byUnique: (constraint: string): ErrorDef | undefined => byUnique.get(constraint),
  byForeignKeyDelete: (constraint: string): ErrorDef | undefined => byForeignKeyDelete.get(constraint),
  /** Todos los nombres de restricción referenciados; los usa un test para compararlos contra la migración. */
  referencedConstraints: (): { unique: readonly string[]; foreignKey: readonly string[] } => ({
    unique: [...byUnique.keys()],
    foreignKey: [...byForeignKeyDelete.keys()],
  }),
} as const
