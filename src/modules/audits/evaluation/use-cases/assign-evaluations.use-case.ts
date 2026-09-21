import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { UserDirectory } from '../../../identity/index.js'
import { LibraryReader } from '../../../library/index.js'
import { assertAuditStaffable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { isReassignable } from '../../domain/evaluation.lifecycle.js'
import { AuditEvents } from '../../domain/events.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import type { AssignEvaluationsT } from '../evaluation.schemas.js'
import { findEvaluations, toEvaluationViews } from '../evaluation.queries.js'

@Injectable()
export class AssignEvaluationsUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
    private readonly users: UserDirectory,
    private readonly library: LibraryReader,
  ) {}

  /**
   * El LÍDER reparte criterios entre los auditores del equipo (o los deja sin asignar con `userId: null`), en borrador o en
   * curso. Solo a un AUDITOR del equipo: el líder revisa, no evalúa. Todo o nada: si alguno ya está enviado a revisión o
   * aprobado, no se cambia ninguno. Idempotente: lo que ya tiene ese responsable no se toca ni deja rastro. Devuelve lo que cambió.
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, input: AssignEvaluationsT) {
    const audit = await loadAudit(this.tx, auditId)
    assertOnAudit('lead', actor, await accessOf(this.tx, actor, audit))
    assertAuditStaffable(audit.status)

    const ids = [...new Set(input.evaluationIds)]
    const rows = await findEvaluations(this.tx, auditId, { id: { in: ids } })
    const found = new Set(rows.map((row) => row.id))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length > 0) throw new DomainError(AuditErrors.EVALUATION_NOT_FOUND, { evaluationIds: missing })

    const assignee = input.userId === null ? null : await this.assignee(auditId, input.userId)
    const changing = rows.filter((row) => (row.assignedUserId ?? null) !== input.userId)
    const blocked = changing.filter((row) => !isReassignable(row.status))
    if (blocked.length > 0) {
      throw new DomainError(AuditErrors.EVALUATION_NOT_REASSIGNABLE, { evaluationIds: blocked.map((row) => row.id) })
    }
    if (changing.length === 0) return []

    await this.tx.evaluation.updateMany({
      where: { auditId, id: { in: changing.map((row) => row.id) } },
      data: { assignedUserId: input.userId },
    })

    const template = await this.library.getTemplate(audit.templateId)
    const titleOf = (controlId: string) => template.tree.pathTo(controlId).at(-1)!.title
    for (const row of changing) {
      const base = { auditId, evaluationId: row.id, controlTitle: titleOf(row.controlId) }
      if (assignee) {
        await this.events.publish(AuditEvents.EvaluationAssigned, {
          ...base,
          targetUserId: assignee.id,
          userName: assignee.name,
          previousUserName: row.assignedUser?.name ?? null,
        })
      } else {
        await this.events.publish(AuditEvents.EvaluationUnassigned, {
          ...base,
          targetUserId: row.assignedUser!.id,
          previousUserName: row.assignedUser!.name,
        })
      }
    }
    return toEvaluationViews(
      await findEvaluations(this.tx, auditId, { id: { in: changing.map((row) => row.id) } }),
      template,
    )
  }

  /** Solo se asigna a un AUDITOR (`MEMBER`) del equipo. */
  private async assignee(auditId: string, userId: string) {
    const member = await this.tx.auditMember.findUnique({ where: { auditId_userId: { auditId, userId } } })
    if (!member) throw new DomainError(AuditErrors.EVALUATION_ASSIGNEE_INVALID, { userId, reason: 'NOT_IN_TEAM' })
    if (member.role === 'LEAD')
      throw new DomainError(AuditErrors.EVALUATION_ASSIGNEE_INVALID, { userId, reason: 'IS_LEAD' })
    return this.users.getOrFail(userId)
  }
}
