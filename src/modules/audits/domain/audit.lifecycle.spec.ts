import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import { DomainError } from '../../../platform/errors/index.js'
import { assertAuditEditable, auditLifecycle } from './audit.lifecycle.js'

/** Contrato de docs/03 §2.4 (Audit): si el grafo cambia, este test obliga a cambiar también el documento. */
describe('ciclo de vida de la auditoría (docs/03 §2.4)', () => {
  it('DRAFT →START→ IN_PROGRESS →CLOSE→ CLOSED →ARCHIVE→ ARCHIVED, sin transiciones hacia atrás', () => {
    expect(auditLifecycle.next('DRAFT', 'START')).toBe('IN_PROGRESS')
    expect(auditLifecycle.next('IN_PROGRESS', 'CLOSE')).toBe('CLOSED')
    expect(auditLifecycle.next('CLOSED', 'ARCHIVE')).toBe('ARCHIVED')
    expect(auditLifecycle.allowed('DRAFT')).toEqual(['START'])
    expect(auditLifecycle.allowed('IN_PROGRESS')).toEqual(['CLOSE'])
    expect(auditLifecycle.allowed('CLOSED')).toEqual(['ARCHIVE'])
    expect(auditLifecycle.allowed('ARCHIVED')).toEqual([])
    expect(auditLifecycle.isFinal('ARCHIVED')).toBe(true)
  })

  it.each([
    ['DRAFT', 'CLOSE'],
    ['DRAFT', 'ARCHIVE'],
    ['IN_PROGRESS', 'START'],
    ['IN_PROGRESS', 'ARCHIVE'],
    ['CLOSED', 'START'],
    ['CLOSED', 'CLOSE'],
    ['ARCHIVED', 'START'],
  ] as const)('%s no admite %s: AUDIT_INVALID_STATE con el estado y el evento', (from, event) => {
    try {
      auditLifecycle.next(from, event)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toMatchObject({ code: 'AUDIT_INVALID_STATE', details: { from, event } })
    }
  })

  it('capacidades: editable solo en borrador; equipo en borrador y en curso; evaluable solo en curso; seguimiento de una cerrada o archivada', () => {
    const tags = (['DRAFT', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED'] as const).map((status) => [
      status,
      (['editable', 'staffable', 'evaluable', 'followable'] as const).filter((tag) => auditLifecycle.has(status, tag)),
    ])
    expect(tags).toEqual([
      ['DRAFT', ['editable', 'staffable']],
      ['IN_PROGRESS', ['staffable', 'evaluable']],
      ['CLOSED', ['followable']],
      ['ARCHIVED', ['followable']],
    ])
  })

  it('assertAuditEditable lanza AUDIT_NOT_EDITABLE fuera del borrador', () => {
    expect(() => assertAuditEditable('DRAFT')).not.toThrow()
    for (const status of ['IN_PROGRESS', 'CLOSED', 'ARCHIVED'] as const) {
      expect(() => assertAuditEditable(status)).toThrow(expect.objectContaining({ code: 'AUDIT_NOT_EDITABLE' }))
    }
  })
})
