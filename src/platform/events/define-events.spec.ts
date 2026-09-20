import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineEvents, eventRegistry } from './define-events.js'

describe('defineEvents', () => {
  it('registra cada evento con su nombre y esquema', () => {
    const Events = defineEvents({ ThingCreated: z.object({ id: z.uuid() }) })
    expect(Events.ThingCreated.name).toBe('ThingCreated')
    expect(eventRegistry.byName('ThingCreated')).toBe(Events.ThingCreated)
    expect(eventRegistry.all().map((e) => e.name)).toContain('ThingCreated')
  })

  it('rechaza nombres que no son PascalCase', () => {
    expect(() => defineEvents({ 'thing.created': z.object({}) })).toThrow(/inválido/)
    expect(() => defineEvents({ thingCreated: z.object({}) })).toThrow(/inválido/)
  })

  it('rechaza eventos duplicados sin dejar el catálogo a medias', () => {
    defineEvents({ DuplicatedOnce: z.object({}) })
    const before = eventRegistry.all().length
    expect(() => defineEvents({ BrandNewEvent: z.object({}), DuplicatedOnce: z.object({}) })).toThrow(/duplicado/)
    expect(eventRegistry.all()).toHaveLength(before)
    expect(eventRegistry.byName('BrandNewEvent')).toBeUndefined()
  })

  it('el tipo del payload sale del esquema (comprobado por tsc)', () => {
    const Events = defineEvents({ TypedThing: z.object({ count: z.number() }) })
    const parsed = Events.TypedThing.schema.parse({ count: 3 })
    const n: number = parsed.count
    expect(n).toBe(3)
  })
})
