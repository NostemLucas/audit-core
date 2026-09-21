import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import { evaluationLifecycle, isReassignable } from './evaluation.lifecycle.js'

/** Contrato de docs/03 §2.4 (Evaluation): si el grafo cambia, este test obliga a cambiar también el documento. */
describe('ciclo de vida del criterio (docs/03 §2.4, docs/06 §3)', () => {
  it('el camino feliz: NOT_STARTED → IN_PROGRESS → COMPLETED → APPROVED', () => {
    expect(evaluationLifecycle.next('NOT_STARTED', 'START')).toBe('IN_PROGRESS')
    expect(evaluationLifecycle.next('IN_PROGRESS', 'COMPLETE')).toBe('COMPLETED')
    expect(evaluationLifecycle.next('COMPLETED', 'APPROVE')).toBe('APPROVED')
  })

  it('devolver y reabrir llevan a RETURNED, desde donde se corrige y se vuelve a enviar', () => {
    expect(evaluationLifecycle.next('COMPLETED', 'RETURN')).toBe('RETURNED')
    expect(evaluationLifecycle.next('APPROVED', 'REOPEN')).toBe('RETURNED')
    expect(evaluationLifecycle.next('RETURNED', 'COMPLETE')).toBe('COMPLETED')
  })

  it('las transiciones posibles desde cada estado, y nada más', () => {
    expect(evaluationLifecycle.allowed('NOT_STARTED')).toEqual(['START'])
    expect(evaluationLifecycle.allowed('IN_PROGRESS')).toEqual(['COMPLETE'])
    expect(evaluationLifecycle.allowed('RETURNED')).toEqual(['COMPLETE'])
    expect(evaluationLifecycle.allowed('COMPLETED')).toEqual(['APPROVE', 'RETURN'])
    expect(evaluationLifecycle.allowed('APPROVED')).toEqual(['REOPEN'])
  })

  it.each([
    ['NOT_STARTED', 'COMPLETE'],
    ['NOT_STARTED', 'APPROVE'],
    ['IN_PROGRESS', 'APPROVE'],
    ['IN_PROGRESS', 'RETURN'],
    ['COMPLETED', 'COMPLETE'],
    ['COMPLETED', 'REOPEN'],
    ['RETURNED', 'APPROVE'],
    ['APPROVED', 'RETURN'],
    ['APPROVED', 'COMPLETE'],
  ] as const)('%s no admite %s: EVALUATION_INVALID_STATE', (from, event) => {
    expect(() => evaluationLifecycle.next(from, event)).toThrow(
      expect.objectContaining({ code: 'EVALUATION_INVALID_STATE', details: { entity: 'EVALUATION', from, event } }),
    )
  })

  it('capacidades: se edita en IN_PROGRESS y RETURNED; enviado espera revisión; aprobado está cerrado', () => {
    const tags = (['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'RETURNED', 'APPROVED'] as const).map((status) => [
      status,
      (['editable', 'reassignable', 'awaitingReview', 'locked'] as const).filter((tag) =>
        evaluationLifecycle.has(status, tag),
      ),
    ])
    expect(tags).toEqual([
      ['NOT_STARTED', ['reassignable']],
      ['IN_PROGRESS', ['editable', 'reassignable']],
      ['COMPLETED', ['awaitingReview']],
      ['RETURNED', ['editable', 'reassignable']],
      ['APPROVED', ['locked']],
    ])
  })

  it('el responsable se cambia salvo cuando está enviado a revisión o aprobado', () => {
    expect((['NOT_STARTED', 'IN_PROGRESS', 'RETURNED'] as const).map(isReassignable)).toEqual([true, true, true])
    expect((['COMPLETED', 'APPROVED'] as const).map(isReassignable)).toEqual([false, false])
  })
})
