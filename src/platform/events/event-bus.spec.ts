import type { ClsService } from 'nestjs-cls'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineEvents } from './define-events.js'
import { EventBus, type DomainEvent } from './event-bus.js'

const Events = defineEvents({
  BusFirstHappened: z.object({ id: z.string(), n: z.number() }),
  BusSecondHappened: z.object({ id: z.string() }),
})

function fakeCls(store: Record<string, string> | null): ClsService {
  return { isActive: () => store !== null, get: (key: string) => store?.[key] } as unknown as ClsService
}
const newBus = (store: Record<string, string> | null = {}) => new EventBus(fakeCls(store))

describe('EventBus', () => {
  it('entrega el evento a los handlers en el orden de suscripción y espera a los asíncronos', async () => {
    const bus = newBus()
    const seen: string[] = []
    bus.on(Events.BusFirstHappened, async () => {
      await new Promise((r) => setTimeout(r, 15))
      seen.push('lento (primero)')
    })
    bus.on(Events.BusFirstHappened, () => void seen.push('rápido (segundo)'))
    await bus.publish(Events.BusFirstHappened, { id: 'a', n: 1 })
    expect(seen).toEqual(['lento (primero)', 'rápido (segundo)']) // el segundo no empieza hasta que termina el primero
  })

  it('on filtra por evento y onAny recibe todos', async () => {
    const bus = newBus()
    const first: string[] = []
    const all: string[] = []
    bus.on(Events.BusFirstHappened, (e) => void first.push(e.name))
    bus.onAny((e) => void all.push(e.name))
    await bus.publish(Events.BusFirstHappened, { id: 'a', n: 1 })
    await bus.publish(Events.BusSecondHappened, { id: 'b' })
    expect(first).toEqual(['BusFirstHappened'])
    expect(all).toEqual(['BusFirstHappened', 'BusSecondHappened'])
  })

  it('valida el payload al publicar: recorta claves extra y entrega el valor ya parseado', async () => {
    const bus = newBus()
    let received: unknown
    bus.on(Events.BusSecondHappened, (e) => void (received = e.payload))
    await bus.publish(Events.BusSecondHappened, { id: 'x', extra: 'no debería pasar' } as never)
    expect(received).toEqual({ id: 'x' })
  })

  it('un payload inválido lanza ANTES de llamar a ningún handler', async () => {
    const bus = newBus()
    let called = false
    bus.onAny(() => void (called = true))
    await expect(bus.publish(Events.BusFirstHappened, { id: 'a', n: 'no-es-numero' } as never)).rejects.toThrow(
      /Payload inválido para el evento BusFirstHappened: n/,
    )
    expect(called).toBe(false)
  })

  it('si un handler falla, el error llega al publicador y los siguientes NO se ejecutan', async () => {
    const bus = newBus()
    let after = false
    bus.onAny(() => {
      throw new Error('handler roto')
    })
    bus.onAny(() => void (after = true))
    await expect(bus.publish(Events.BusSecondHappened, { id: 'a' })).rejects.toThrow('handler roto')
    expect(after).toBe(false)
  })

  it('incluye el usuario y el requestId del contexto de la petición', async () => {
    const bus = newBus({ userId: 'user-1', requestId: 'trace-9' })
    let event: DomainEvent | undefined
    bus.onAny((e) => void (event = e))
    await bus.publish(Events.BusSecondHappened, { id: 'a' })
    expect(event).toMatchObject({ name: 'BusSecondHappened', actorId: 'user-1', requestId: 'trace-9' })
    expect(event?.occurredAt).toBeInstanceOf(Date)
  })

  it('sin contexto activo (seeds, jobs) no hay actor ni requestId, y no falla', async () => {
    const bus = newBus(null)
    let event: DomainEvent | undefined
    bus.onAny((e) => void (event = e))
    await bus.publish(Events.BusSecondHappened, { id: 'a' })
    expect(event?.actorId).toBeUndefined()
    expect(event?.requestId).toBeUndefined()
  })

  it('un handler suscrito mientras se publica no altera esa publicación', async () => {
    const bus = newBus()
    const seen: string[] = []
    bus.onAny(() => {
      seen.push('original')
      bus.onAny(() => void seen.push('tardío'))
    })
    await bus.publish(Events.BusSecondHappened, { id: 'a' })
    expect(seen).toEqual(['original'])
  })
})
