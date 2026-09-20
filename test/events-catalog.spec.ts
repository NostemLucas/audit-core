import { describe, expect, it } from 'vitest'
import '../src/app-events.js'
import { eventRegistry, eventsWithoutMessage } from '../src/platform/events/index.js'

describe('catálogo de eventos', () => {
  it('todo evento registrado tiene su mensaje en español', () => {
    expect(eventsWithoutMessage(), 'eventos sin mensaje: agrégalos con defineMessages').toEqual([])
  })

  it('los nombres son únicos y PascalCase', () => {
    const names = eventRegistry.all().map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[A-Z][A-Za-z0-9]+$/)
  })
})
