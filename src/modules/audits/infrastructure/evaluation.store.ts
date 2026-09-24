import { Injectable } from '@nestjs/common'
import { InjectTx, type Tx, versionConflict } from '../../../platform/db/index.js'
import { EventBus } from '../../../platform/events/index.js'
import { LibraryReader, type TemplateForAudit } from '../../library/index.js'
import type { Actor } from '../domain/audit-policy.js'
import type { EvaluationDecision, EvaluationState } from '../domain/evaluation.decider.js'
import { loadEvaluation } from '../evaluation/evaluation.queries.js'
import { accessOf, loadAuditForUpdate } from './audit.queries.js'

/**
 * El ÚNICO camino para aplicar un comando del decider de `Evaluation` (`domain/evaluation.decider.ts`). Hace, en este
 * orden y siempre igual, lo que antes repetía cada caso de uso:
 *
 *  1. `loadAuditForUpdate`: el candado de la auditoría, ANTES que cualquier otra fila (docs/06 §10). Mismo orden en
 *     toda transición: serializa contra `CloseAudit` y evita el deadlock con el `FOR KEY SHARE` de `audit_events`.
 *  2. Carga el estado completo que el decider necesita (criterio, acceso, escala, evidencia, título del control).
 *  3. Decide (puro).
 *  4. Escribe con compare-and-swap sobre la VERSIÓN leída — no solo el estado: si el contenido cambió entre la
 *     lectura y la escritura, lo copiado en el evento ya no sería lo que se aprobó. Con el candado del paso 1 no
 *     debería perderse nunca; si pasa, es `VERSION_CONFLICT` y quien llama relee — nunca un éxito sin escritura.
 *  5. Publica el evento de la decisión, en la misma transacción.
 *
 * Quien llama pone `@Transactional()`: el store no abre transacciones, participa de la del caso de uso.
 */
@Injectable()
export class EvaluationStore {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  async execute(
    actor: Actor,
    auditId: string,
    evaluationId: string,
    decide: (state: EvaluationState) => EvaluationDecision,
  ) {
    const audit = await loadAuditForUpdate(this.tx, auditId)
    const evaluation = await loadEvaluation(this.tx, auditId, evaluationId)
    const [access, template, scale, evidence] = await Promise.all([
      accessOf(this.tx, actor, audit),
      this.library.getTemplate(audit.templateId),
      this.library.getScale(audit.scaleId),
      this.tx.evidence.findMany({
        where: { evaluationId, deletedAt: null },
        select: { id: true, title: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ])
    const valueOf = (levelId: string | null) =>
      levelId ? (scale.levels.find((level) => level.id === levelId) ?? null) : null

    const { to, patch, event } = decide({
      auditId,
      evaluationId,
      controlTitle: controlTitleOf(template, evaluation.controlId),
      auditStatus: audit.status,
      access,
      status: evaluation.status,
      assignedUserId: evaluation.assignedUserId,
      content: evaluation,
      scale: {
        dimension: scale.dimension,
        minimum: scale.levels[0]!.value,
        expected: valueOf(evaluation.expectedLevelId)?.value ?? null,
        achieved: valueOf(evaluation.achievedLevelId),
      },
      evidence,
    })

    const { count } = await this.tx.evaluation.updateMany({
      where: { id: evaluationId, version: evaluation.version },
      data: { ...patch, status: to },
    })
    if (count === 0) throw versionConflict('Evaluation', evaluationId, evaluation.version)
    await this.events.publish(event.def, event.payload)

    return { row: await loadEvaluation(this.tx, auditId, evaluationId), template }
  }
}

const controlTitleOf = (template: TemplateForAudit, controlId: string): string =>
  template.tree.pathTo(controlId).at(-1)!.title
