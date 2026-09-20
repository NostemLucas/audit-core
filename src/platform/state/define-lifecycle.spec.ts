import { describe, expect, it } from 'vitest'
import { DomainError, defineErrors } from '../errors'
import { defineLifecycle } from './define-lifecycle'

const Errors = defineErrors({
  DEMO_INVALID_STATE: { http: 409, message: 'Estado inválido' },
  DEMO_NOT_EDITABLE: { http: 409, message: 'No editable' },
})

type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
type Event = 'PUBLISH' | 'ARCHIVE'
type Tag = 'editable' | 'usable'

const lifecycle = defineLifecycle<Status, Event, Tag>({
  entity: 'DEMO',
  invalidState: Errors.DEMO_INVALID_STATE,
  states: {
    DRAFT: { on: { PUBLISH: 'PUBLISHED' }, tags: ['editable'] },
    PUBLISHED: { on: { ARCHIVE: 'ARCHIVED' }, tags: ['usable'] },
    ARCHIVED: { on: {}, tags: [] },
  },
})

describe('defineLifecycle', () => {
  it('can / next siguen el grafo', () => {
    expect(lifecycle.can('DRAFT', 'PUBLISH')).toBe(true)
    expect(lifecycle.can('DRAFT', 'ARCHIVE')).toBe(false)
    expect(lifecycle.next('DRAFT', 'PUBLISH')).toBe('PUBLISHED')
    expect(lifecycle.next('PUBLISHED', 'ARCHIVE')).toBe('ARCHIVED')
  })

  it('next rechaza un evento no permitido con el error del catálogo y el contexto', () => {
    try {
      lifecycle.next('ARCHIVED', 'PUBLISH')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError)
      expect((e as DomainError).code).toBe('DEMO_INVALID_STATE')
      expect((e as DomainError).details).toEqual({ entity: 'DEMO', from: 'ARCHIVED', event: 'PUBLISH' })
    }
  })

  it('allowed lista los eventos posibles y isFinal marca los terminales', () => {
    expect(lifecycle.allowed('DRAFT')).toEqual(['PUBLISH'])
    expect(lifecycle.allowed('ARCHIVED')).toEqual([])
    expect(lifecycle.isFinal('ARCHIVED')).toBe(true)
    expect(lifecycle.isFinal('DRAFT')).toBe(false)
  })

  it('has / assert consultan la capacidad del estado', () => {
    expect(lifecycle.has('DRAFT', 'editable')).toBe(true)
    expect(lifecycle.has('PUBLISHED', 'editable')).toBe(false)
    expect(() => lifecycle.assert('DRAFT', 'editable', Errors.DEMO_NOT_EDITABLE)).not.toThrow()
    expect(() => lifecycle.assert('PUBLISHED', 'editable', Errors.DEMO_NOT_EDITABLE)).toThrow(DomainError)
  })

  it('states conserva el orden de declaración', () => {
    expect(lifecycle.states).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  })

  it('genera el diagrama Mermaid', () => {
    expect(lifecycle.toMermaid()).toBe(
      ['stateDiagram-v2', '  DRAFT --> PUBLISHED: PUBLISH', '  PUBLISHED --> ARCHIVED: ARCHIVE', '  ARCHIVED --> [*]'].join('\n'),
    )
  })

  it('un destino inexistente falla al definir el ciclo', () => {
    expect(() =>
      defineLifecycle<Status, Event, Tag>({
        entity: 'BAD',
        invalidState: Errors.DEMO_INVALID_STATE,
        states: {
          DRAFT: { on: { PUBLISH: 'NOPE' as Status }, tags: [] },
          PUBLISHED: { on: {}, tags: [] },
          ARCHIVED: { on: {}, tags: [] },
        },
      }),
    ).toThrow(/estado inexistente/)
  })

  it('un estado faltante no compila (exhaustividad)', () => {
    // Lo comprueba `tsc --noEmit`: si `@ts-expect-error` no viese error, el typecheck fallaría.
    const build = () =>
      defineLifecycle<Status, Event, Tag>({
        entity: 'INCOMPLETE',
        invalidState: Errors.DEMO_INVALID_STATE,
        // @ts-expect-error falta el estado ARCHIVED
        states: {
          DRAFT: { on: {}, tags: [] },
          PUBLISHED: { on: {}, tags: [] },
        },
      })
    expect(typeof build).toBe('function')
  })
})
