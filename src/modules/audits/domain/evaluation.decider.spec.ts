import { describe, expect, it } from 'vitest'
import '../../../app-errors.js'
import type { Actor } from './audit-policy.js'
import {
  approveEvaluation,
  completeEvaluation,
  type EvaluationState,
  reopenEvaluation,
  returnEvaluation,
  updateEvaluationContent,
} from './evaluation.decider.js'

const ANA: Actor = { id: 'ana', roles: ['AUDITOR'] } // la auditora asignada (MEMBER)
const LIDER: Actor = { id: 'lider', roles: ['AUDITOR'] }

const LEVELS = [
  { id: 'no-cumple', value: 0, label: 'No cumple' },
  { id: 'parcial', value: 50, label: 'Parcial' },
  { id: 'cumple', value: 100, label: 'Cumple' },
]

/** Un criterio en curso, asignado a Ana, que ya cumple todo para enviarse (conformidad, alcanzó lo esperado). */
const state = (over: Partial<EvaluationState> = {}, actor: Actor = ANA): EvaluationState => ({
  auditId: 'audit-1',
  evaluationId: 'ev-1',
  controlTitle: 'Roles',
  auditStatus: 'IN_PROGRESS',
  access: { managerId: 'gerente', memberRole: actor.id === 'lider' ? 'LEAD' : 'MEMBER' },
  status: 'IN_PROGRESS',
  assignedUserId: 'ana',
  content: {
    achievedLevelId: 'cumple',
    isNotApplicable: false,
    notApplicableReason: null,
    findings: null,
    severity: null,
    notes: 'nota',
  },
  scale: {
    dimension: 'CONFORMITY',
    minimum: 0,
    expected: 100,
    achieved: { value: 100, label: 'Cumple' },
    levels: LEVELS,
  },
  evidence: [{ id: 'e-1', title: 'Acta' }],
  ...over,
})

describe('completeEvaluation (el auditor envía a revisión)', () => {
  it('pasa a COMPLETED y el evento copia lo enviado, evidencia incluida', () => {
    const decision = completeEvaluation(state(), ANA)
    expect(decision.to).toBe('COMPLETED')
    expect(decision.patch).toEqual({})
    expect(decision.event!.def.name).toBe('EvaluationCompleted')
    expect(decision.event!.payload).toMatchObject({
      auditId: 'audit-1',
      evaluationId: 'ev-1',
      controlTitle: 'Roles',
      achievedLevelLabel: 'Cumple',
      notes: 'nota',
      evidence: [{ id: 'e-1', title: 'Acta' }],
    })
  })

  it('las comprobaciones van en orden: auditoría → quién → estado → contenido', () => {
    // todo mal a la vez: gana la auditoría fuera de curso
    const allWrong = state({ auditStatus: 'CLOSED', assignedUserId: 'otro', status: 'APPROVED', evidence: [] })
    expect(() => completeEvaluation(allWrong, ANA)).toThrow(expect.objectContaining({ code: 'AUDIT_NOT_EVALUABLE' }))
    // auditoría bien: gana que no es la asignada
    expect(() => completeEvaluation({ ...allWrong, auditStatus: 'IN_PROGRESS' }, ANA)).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }),
    )
    // asignada: gana el estado, antes de exigir contenido
    expect(() => completeEvaluation(state({ status: 'APPROVED', evidence: [] }), ANA)).toThrow(
      expect.objectContaining({ code: 'EVALUATION_INVALID_STATE' }),
    )
  })

  it('el líder no evalúa: solo el auditor asignado envía', () => {
    expect(() => completeEvaluation(state({ assignedUserId: 'lider' }, LIDER), LIDER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }),
    )
  })

  it('por debajo de lo esperado en conformidad exige hallazgo y gravedad; por encima del mínimo, evidencia', () => {
    const below = state({
      scale: {
        dimension: 'CONFORMITY',
        minimum: 0,
        expected: 100,
        achieved: { value: 50, label: 'Parcial' },
        levels: LEVELS,
      },
      evidence: [],
    })
    expect(() => completeEvaluation(below, ANA)).toThrow(
      expect.objectContaining({
        code: 'EVALUATION_INCOMPLETE',
        details: { missing: ['FINDINGS', 'SEVERITY', 'EVIDENCE'] },
      }),
    )
  })

  it('"no aplica" con motivo se envía sin nivel ni evidencia', () => {
    const na = state({
      content: { ...state().content, achievedLevelId: null, isNotApplicable: true, notApplicableReason: 'Sin sedes' },
      scale: { dimension: 'CONFORMITY', minimum: 0, expected: 100, achieved: null, levels: LEVELS },
      evidence: [],
    })
    expect(completeEvaluation(na, ANA).to).toBe('COMPLETED')
  })

  it('desde RETURNED también se reenvía', () => {
    expect(completeEvaluation(state({ status: 'RETURNED' }), ANA).to).toBe('COMPLETED')
  })
})

describe('acciones del líder', () => {
  const sent = (over: Partial<EvaluationState> = {}) => state({ status: 'COMPLETED', ...over }, LIDER)

  it('aprobar: APPROVED, guarda requiresFollowUp y lo lleva al evento', () => {
    const decision = approveEvaluation(sent(), LIDER, { comments: null, requiresFollowUp: true })
    expect(decision.to).toBe('APPROVED')
    expect(decision.patch).toEqual({ requiresFollowUp: true })
    expect(decision.event!.def.name).toBe('EvaluationApproved')
    expect(decision.event!.payload).toMatchObject({ comments: null, requiresFollowUp: true, controlTitle: 'Roles' })
  })

  it('devolver: RETURNED con el comentario en el evento', () => {
    const decision = returnEvaluation(sent(), LIDER, { comments: 'Falta el acta firmada' })
    expect(decision.to).toBe('RETURNED')
    expect(decision.event!.payload).toMatchObject({ comments: 'Falta el acta firmada' })
  })

  it('reabrir: solo desde APPROVED, y deja de ser un traslado (carriedFromId = null)', () => {
    const decision = reopenEvaluation(sent({ status: 'APPROVED' }), LIDER, { comments: 'Revisar' })
    expect(decision.to).toBe('RETURNED')
    expect(decision.patch).toEqual({ carriedFromId: null })
    expect(() => reopenEvaluation(sent(), LIDER, { comments: 'x' })).toThrow(
      expect.objectContaining({ code: 'EVALUATION_INVALID_STATE' }),
    )
  })

  it.each([
    ['aprobar', (s: EvaluationState, a: Actor) => approveEvaluation(s, a, { comments: null, requiresFollowUp: false })],
    ['devolver', (s: EvaluationState, a: Actor) => returnEvaluation(s, a, { comments: 'x' })],
    ['reabrir', (s: EvaluationState, a: Actor) => reopenEvaluation({ ...s, status: 'APPROVED' }, a, { comments: 'x' })],
  ])('%s: exige auditoría en curso y ser el LÍDER (ni la auditora, ni el manager)', (_name, act) => {
    expect(() => act(sent({ auditStatus: 'CLOSED' }), LIDER)).toThrow(
      expect.objectContaining({ code: 'AUDIT_NOT_EVALUABLE' }),
    )
    expect(() => act(state({ status: 'COMPLETED' }), ANA)).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }),
    )
    const manager: Actor = { id: 'gerente', roles: ['GERENTE'] }
    expect(() => act(sent({ access: { managerId: 'gerente', memberRole: null } }), manager)).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }),
    )
  })
})

describe('updateEvaluationContent (el auditor edita)', () => {
  it('el primer envío arranca el criterio y anuncia EvaluationStarted', () => {
    const decision = updateEvaluationContent(state({ status: 'NOT_STARTED' }), ANA, { notes: 'en curso' })
    expect(decision.to).toBe('IN_PROGRESS')
    expect(decision.patch).toEqual({ notes: 'en curso' })
    expect(decision.event!.def.name).toBe('EvaluationStarted')
  })

  it('editar sin arrancar (ya IN_PROGRESS o RETURNED) no cambia el estado ni anuncia nada', () => {
    const decision = updateEvaluationContent(state({ status: 'IN_PROGRESS' }), ANA, { notes: 'actualizado' })
    expect(decision.to).toBe('IN_PROGRESS')
    expect(decision.event).toBeUndefined()
    expect(updateEvaluationContent(state({ status: 'RETURNED' }), ANA, { notes: 'x' }).to).toBe('RETURNED')
  })

  it('enviado a revisión o aprobado no se edita: EVALUATION_NOT_EDITABLE', () => {
    for (const status of ['COMPLETED', 'APPROVED'] as const) {
      expect(() => updateEvaluationContent(state({ status }), ANA, { notes: 'x' })).toThrow(
        expect.objectContaining({ code: 'EVALUATION_NOT_EDITABLE' }),
      )
    }
  })

  it('solo el auditor asignado edita; auditoría fuera de curso, tampoco', () => {
    expect(() => updateEvaluationContent(state({ assignedUserId: 'otro' }), ANA, { notes: 'x' })).toThrow(
      expect.objectContaining({ code: 'AUDIT_ACCESS_DENIED' }),
    )
    expect(() => updateEvaluationContent(state({ auditStatus: 'CLOSED' }), ANA, { notes: 'x' })).toThrow(
      expect.objectContaining({ code: 'AUDIT_NOT_EVALUABLE' }),
    )
  })

  it('un nivel que no pertenece a la escala: EVALUATION_LEVEL_NOT_IN_SCALE', () => {
    expect(() => updateEvaluationContent(state(), ANA, { achievedLevelId: 'de-otra-escala' })).toThrow(
      expect.objectContaining({ code: 'EVALUATION_LEVEL_NOT_IN_SCALE' }),
    )
  })

  it('"no aplica" y nivel alcanzado son excluyentes: hay que desmarcar "no aplica" primero', () => {
    const na = state({ content: { ...state().content, isNotApplicable: true } })
    expect(() => updateEvaluationContent(na, ANA, { achievedLevelId: 'cumple' })).toThrow(
      expect.objectContaining({ code: 'EVALUATION_IS_NOT_APPLICABLE' }),
    )
    // desmarcando explícitamente sí se puede
    const decision = updateEvaluationContent(na, ANA, { achievedLevelId: 'cumple', isNotApplicable: false })
    expect(decision.patch).toMatchObject({ achievedLevelId: 'cumple', isNotApplicable: false })
  })

  it('marcar "no aplica" exige un motivo (propio o ya guardado)', () => {
    expect(() => updateEvaluationContent(state(), ANA, { isNotApplicable: true })).toThrow(
      expect.objectContaining({ code: 'NOT_APPLICABLE_REASON_REQUIRED' }),
    )
    const decision = updateEvaluationContent(state(), ANA, { isNotApplicable: true, notApplicableReason: 'Sin sedes' })
    expect(decision.patch).toMatchObject({ isNotApplicable: true, achievedLevelId: null, severity: null })
  })
})
