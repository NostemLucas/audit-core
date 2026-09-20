import { z } from 'zod'

/**
 * Catálogo de eventos de dominio. Cada módulo declara los suyos en su `events.ts` con `defineEvents`: el nombre y el
 * esquema del payload (Zod) son la ÚNICA definición de un evento. De ahí salen la validación al publicar, el tipo del
 * payload en los handlers y la lectura tipada del historial.
 *
 * Nombre: PascalCase, en participio, por lo que ya ocurrió (`AuditStarted`, `EvaluationApproved`). Ver docs/03 §2.1.
 */
export interface EventDef<N extends string = string, P = unknown> {
  readonly name: N
  readonly schema: z.ZodType<P>
}

export type PayloadOf<D> = D extends EventDef<string, infer P> ? P : never

const NAME_FORMAT = /^[A-Z][A-Za-z0-9]+$/
const byName = new Map<string, EventDef>()

export function defineEvents<const T extends Record<string, z.ZodType>>(
  schemas: T,
): { readonly [K in keyof T & string]: EventDef<K, z.output<T[K]>> } {
  // Se valida todo antes de registrar nada: un fallo no deja el catálogo a medias.
  for (const name of Object.keys(schemas)) {
    if (!NAME_FORMAT.test(name))
      throw new Error(`Nombre de evento inválido: "${name}" (PascalCase, p. ej. AuditStarted)`)
    if (byName.has(name)) throw new Error(`Evento duplicado: ${name}`)
  }
  const result: Record<string, EventDef> = {}
  for (const [name, schema] of Object.entries(schemas)) {
    const def: EventDef = { name, schema }
    byName.set(name, def)
    result[name] = def
  }
  return result as { readonly [K in keyof T & string]: EventDef<K, z.output<T[K]>> }
}

export const eventRegistry = {
  all: (): readonly EventDef[] => [...byName.values()],
  byName: (name: string): EventDef | undefined => byName.get(name),
} as const
