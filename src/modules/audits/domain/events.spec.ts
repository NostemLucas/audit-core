import { describe, expect, it } from 'vitest'
import '../../../app-events.js'
import { eventRegistry } from '../../../platform/events/define-events.js'
import { renderEventMessage } from '../../../platform/events/define-messages.js'
import { AuditEvents, subjectOf } from './events.js'

const ID = '0199c0de-0000-7000-8000-000000000001'
const ID2 = '0199c0de-0000-7000-8000-000000000002'

describe('eventos de la auditoría', () => {
  it('TODO evento de auditoría exige auditId (el registrador lo necesita para guardarlo)', () => {
    for (const def of Object.values(AuditEvents)) {
      const withoutAudit = def.schema.safeParse({ code: 'x', name: 'x', changed: ['name'], scopeItemId: ID })
      expect(withoutAudit.success, def.name).toBe(false)
    }
  })

  it('los eventos de auditoría están en el catálogo global', () => {
    const names = eventRegistry.all().map((e) => e.name)
    for (const name of Object.keys(AuditEvents)) expect(names).toContain(name)
  })

  it('subjectOf: de qué trata el evento, por convención', () => {
    expect(subjectOf({ auditId: ID })).toEqual({ type: 'Audit', id: ID })
    expect(subjectOf({ auditId: ID, scopeItemId: ID2 })).toEqual({ type: 'ScopeItem', id: ID2 })
    expect(subjectOf({ auditId: ID, memberId: ID2 })).toEqual({ type: 'AuditMember', id: ID2 })
    expect(subjectOf({ auditId: ID, evaluationId: ID2, memberId: 'x' })).toEqual({ type: 'Evaluation', id: ID2 })
  })

  it('el texto se genera al leer, en español, y un payload que ya no cumple el esquema no rompe el historial', () => {
    expect(renderEventMessage('AuditCreated', { auditId: ID, code: 'AUD-2026-00001', name: 'ISO' })).toBe(
      'Creó la auditoría AUD-2026-00001 — ISO',
    )
    expect(renderEventMessage('AuditUpdated', { auditId: ID, changed: ['name', 'plannedEnd'] })).toBe(
      'Modificó el nombre, la fecha de fin prevista',
    )
    expect(renderEventMessage('ScopeItemAdded', { auditId: ID, scopeItemId: ID2, name: 'ERP' })).toBe(
      'Agregó "ERP" al alcance',
    )
    expect(renderEventMessage('AuditCreated', { auditId: ID })).toBeUndefined()
    expect(renderEventMessage('EventoQueYaNoExiste', {})).toBeUndefined()
  })
})
