import { Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import '../context/cls-store.js'
import type { EventDef } from './define-events.js'

/** Lo que recibe un handler: el evento validado más el contexto de la petición que lo originó. */
export interface DomainEvent<N extends string = string, P = unknown> {
  readonly name: N
  readonly payload: P
  readonly occurredAt: Date
  /** Usuario de la petición (CLS). Ausente en seeds y jobs. */
  readonly actorId?: string
  /** Mismo valor que `x-request-id` / `traceId`. */
  readonly requestId?: string
}

export type EventHandler<N extends string = string, P = unknown> = (event: DomainEvent<N, P>) => void | Promise<void>

interface Subscription {
  readonly names: ReadonlySet<string> | null
  readonly handle: EventHandler
}

/**
 * Bus de eventos de dominio, SÍNCRONO y DENTRO de la transacción en curso.
 *
 * `publish` espera a todos los handlers, en el orden en que se suscribieron. Como corren en el mismo contexto de
 * ejecución (CLS), un handler que escribe con `@InjectTx()` participa de la transacción del caso de uso que publicó:
 *   - si el handler falla, el error sube al publicador y la transacción entera se revierte;
 *   - si el caso de uso falla después, lo que escribieron los handlers se revierte con él.
 * Nunca quedan estados a medias (ni un historial de algo que no ocurrió). Por eso NO se usa `@nestjs/event-emitter`.
 *
 * Reglas: los handlers son rápidos y solo escriben en la BD; el trabajo externo (Nextcloud, email) no va aquí sino
 * después del commit. Un handler no debe publicar un evento que lo dispare a sí mismo.
 */
@Injectable()
export class EventBus {
  private readonly subscriptions: Subscription[] = []

  constructor(private readonly cls: ClsService) {}

  /** Se suscribe a UN evento, con el payload ya tipado. Se llama desde `onModuleInit` del handler. */
  on<N extends string, P>(def: EventDef<N, P>, handle: EventHandler<N, P>): void {
    this.subscriptions.push({ names: new Set([def.name]), handle: handle as EventHandler })
  }

  /** Se suscribe a TODOS los eventos (p. ej. el registrador del historial de auditoría). */
  onAny(handle: EventHandler): void {
    this.subscriptions.push({ names: null, handle })
  }

  async publish<N extends string, P>(def: EventDef<N, P>, payload: P): Promise<void> {
    const parsed = def.schema.safeParse(payload)
    if (!parsed.success) {
      // Un payload que no cumple su propio esquema es un bug del que publica: se descubre aquí, no en el historial.
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ')
      throw new Error(`Payload inválido para el evento ${def.name}: ${detail}`, { cause: parsed.error })
    }

    const active = this.cls.isActive()
    const event: DomainEvent<N, P> = {
      name: def.name,
      payload: parsed.data,
      occurredAt: new Date(),
      actorId: active ? this.cls.get('userId') : undefined,
      requestId: active ? this.cls.get('requestId') || undefined : undefined,
    }

    for (const { names, handle } of [...this.subscriptions]) {
      if (names === null || names.has(def.name)) await handle(event)
    }
  }
}
