import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../../platform/errors/index.js'
import '../../../../app-errors.js'
import { assertTemplateEditable, templateLifecycle } from './template.lifecycle.js'

/** Contrato de docs/03 §2.4 (Template): si el grafo cambia, este test obliga a cambiar también el documento. */
describe('ciclo de vida de la plantilla (docs/03 §2.4)', () => {
  it('DRAFT →PUBLISH→ PUBLISHED →ARCHIVE→ ARCHIVED, y nada más', () => {
    expect(templateLifecycle.next('DRAFT', 'PUBLISH')).toBe('PUBLISHED')
    expect(templateLifecycle.next('PUBLISHED', 'ARCHIVE')).toBe('ARCHIVED')
    expect(templateLifecycle.allowed('DRAFT')).toEqual(['PUBLISH'])
    expect(templateLifecycle.allowed('PUBLISHED')).toEqual(['ARCHIVE'])
    expect(templateLifecycle.allowed('ARCHIVED')).toEqual([])
    expect(templateLifecycle.isFinal('ARCHIVED')).toBe(true)
  })

  it.each([
    ['DRAFT', 'ARCHIVE'],
    ['PUBLISHED', 'PUBLISH'],
    ['ARCHIVED', 'PUBLISH'],
    ['ARCHIVED', 'ARCHIVE'],
  ] as const)('%s no admite %s: TEMPLATE_INVALID_STATE con el estado y el evento', (from, event) => {
    expect(() => templateLifecycle.next(from, event)).toThrow(DomainError)
    try {
      templateLifecycle.next(from, event)
    } catch (error) {
      expect(error).toMatchObject({ code: 'TEMPLATE_INVALID_STATE', details: { from, event } })
    }
  })

  it('solo el borrador es editable; solo la publicada es utilizable', () => {
    expect(templateLifecycle.has('DRAFT', 'editable')).toBe(true)
    expect(templateLifecycle.has('PUBLISHED', 'editable')).toBe(false)
    expect(templateLifecycle.has('ARCHIVED', 'editable')).toBe(false)
    expect(templateLifecycle.has('PUBLISHED', 'usable')).toBe(true)
    expect(templateLifecycle.has('DRAFT', 'usable')).toBe(false)
    expect(templateLifecycle.has('ARCHIVED', 'usable')).toBe(false)
  })

  it('assertTemplateEditable lanza TEMPLATE_NOT_EDITABLE fuera del borrador', () => {
    expect(() => assertTemplateEditable('DRAFT')).not.toThrow()
    for (const status of ['PUBLISHED', 'ARCHIVED'] as const) {
      expect(() => assertTemplateEditable(status)).toThrow(expect.objectContaining({ code: 'TEMPLATE_NOT_EDITABLE' }))
    }
  })
})
