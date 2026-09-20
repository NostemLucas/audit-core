import { eventRegistry, type EventDef, type PayloadOf } from './define-events.js'

/**
 * Texto en español de cada evento. Los eventos se guardan sin texto (`type` + `payload`); el mensaje se genera al
 * leer, para poder cambiar la redacción o el idioma sin tocar el historial.
 *
 * El mapa es EXHAUSTIVO en compilación: agregar un evento sin su mensaje no compila (docs/02 §6).
 */
export type MessageMap<T extends Record<string, EventDef>> = {
  readonly [K in keyof T & string]: (payload: PayloadOf<T[K]>) => string
}

const renderers = new Map<string, (payload: never) => string>()

export function defineMessages<const T extends Record<string, EventDef>>(events: T, messages: MessageMap<T>): MessageMap<T> {
  for (const name of Object.keys(events)) {
    if (renderers.has(name)) throw new Error(`Ya hay un mensaje registrado para el evento ${name}`)
  }
  for (const name of Object.keys(events)) renderers.set(name, messages[name as keyof T & string] as (payload: never) => string)
  return messages
}

/**
 * Mensaje de un evento guardado. Valida el payload contra el esquema actual del evento; devuelve `undefined` si el
 * evento ya no existe (una fila antigua no debe romper el historial).
 */
export function renderEventMessage(name: string, payload: unknown): string | undefined {
  const def = eventRegistry.byName(name)
  const render = renderers.get(name)
  if (!def || !render) return undefined
  const parsed = def.schema.safeParse(payload)
  return parsed.success ? (render as (p: unknown) => string)(parsed.data) : undefined
}

/** Eventos registrados que no tienen mensaje (lo usa un test del catálogo). */
export function eventsWithoutMessage(): readonly string[] {
  return eventRegistry.all().map((e) => e.name).filter((name) => !renderers.has(name))
}
