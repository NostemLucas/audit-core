import { DomainError, type ErrorDef } from '../errors'

/**
 * Ciclo de vida de una entidad: un grafo de estados con etiquetas de capacidad. Ver docs/03-state-standard.md.
 *
 * Es un dato puro: sin guards, sin efectos, sin I/O. Las precondiciones y los efectos de cada transición viven en
 * el método de la entidad (que primero pide `next()` y luego valida y asigna).
 *
 * `states` es un `Record<S, …>`: al pasar el enum de Prisma como `S`, un estado faltante o sobrante no compila.
 */

export interface StateSpec<S extends string, E extends string, T extends string> {
  /** Eventos que salen de este estado y su destino. */
  readonly on: Readonly<Partial<Record<E, S>>>
  /** Capacidades que tiene la entidad mientras esté en este estado (`editable`, `usable`…). */
  readonly tags: readonly T[]
}

export interface LifecycleSpec<S extends string, E extends string, T extends string> {
  /** Nombre de la entidad, para mensajes y diagramas (`TEMPLATE`, `AUDIT`, `EVALUATION`). */
  readonly entity: string
  /** Error del catálogo (`<ENTIDAD>_INVALID_STATE`) que se lanza cuando el grafo rechaza un evento. */
  readonly invalidState: ErrorDef
  readonly states: Readonly<Record<S, StateSpec<S, E, T>>>
}

export interface Lifecycle<S extends string, E extends string, T extends string> {
  readonly entity: string
  /** Todos los estados, en el orden en que se declararon. */
  readonly states: readonly S[]
  can(status: S, event: E): boolean
  /** Estado destino, o lanza `DomainError(invalidState, { entity, from, event })`. */
  next(status: S, event: E): S
  /** Eventos posibles desde `status` (estructural: no incluye precondiciones ni permisos). */
  allowed(status: S): readonly E[]
  has(status: S, tag: T): boolean
  /** Lanza `error` (`<ENTIDAD>_NOT_<CAPACIDAD>`) si `status` no tiene la capacidad `tag`. */
  assert(status: S, tag: T, error: ErrorDef): void
  /** Sin transiciones de salida. */
  isFinal(status: S): boolean
  toMermaid(): string
}

export function defineLifecycle<S extends string, E extends string, T extends string = never>(
  spec: LifecycleSpec<S, E, T>,
): Lifecycle<S, E, T> {
  const states = Object.keys(spec.states) as S[]

  // Un destino que no existe como estado es un error de definición: se descubre al cargar el módulo.
  for (const from of states) {
    for (const [event, to] of Object.entries(spec.states[from].on) as [E, S | undefined][]) {
      if (to !== undefined && !(to in spec.states)) {
        throw new Error(`${spec.entity}: el evento ${event} desde ${from} apunta a un estado inexistente (${to})`)
      }
    }
  }

  const allowed = (status: S): readonly E[] => Object.keys(spec.states[status].on) as E[]

  return {
    entity: spec.entity,
    states,
    can: (status, event) => spec.states[status].on[event] !== undefined,
    next(status, event) {
      const to = spec.states[status].on[event]
      if (to === undefined) {
        throw new DomainError(spec.invalidState, { entity: spec.entity, from: status, event })
      }
      return to
    },
    allowed,
    has: (status, tag) => spec.states[status].tags.includes(tag),
    assert(status, tag, error) {
      if (!spec.states[status].tags.includes(tag)) {
        throw new DomainError(error, { entity: spec.entity, status, required: tag })
      }
    },
    isFinal: (status) => allowed(status).length === 0,
    toMermaid() {
      const lines = ['stateDiagram-v2']
      for (const from of states) {
        for (const [event, to] of Object.entries(spec.states[from].on) as [E, S][]) {
          lines.push(`  ${from} --> ${to}: ${event}`)
        }
        if (allowed(from).length === 0) lines.push(`  ${from} --> [*]`)
      }
      return lines.join('\n')
    },
  }
}
