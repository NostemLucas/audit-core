import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { assertAuditEditable } from '../../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditErrors } from '../../domain/errors.js'
import { AuditEvents, type AuditField } from '../../domain/events.js'
import { accessOf, loadAudit, loadAuditView } from '../../infrastructure/audit.queries.js'
import { withAccess } from '../audit.presenter.js'
import type { UpdateAuditT } from '../audit.schemas.js'

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)

@Injectable()
export class UpdateAuditUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    private readonly events: EventBus,
  ) {}

  /**
   * Cambia datos de la auditoría, solo en borrador y solo su manager. Registra únicamente lo que CAMBIÓ; si nada cambió, no
   * escribe ni deja rastro. La plantilla, la organización y la escala no se cambian (docs/06 §2).
   */
  @Transactional()
  async execute(actor: Actor, id: string, input: UpdateAuditT) {
    const audit = await loadAudit(this.tx, id)
    const access = await accessOf(this.tx, actor, audit)
    assertOnAudit('manage', actor, access)
    assertAuditEditable(audit.status)

    const plannedStart = input.plannedStart === undefined ? day(audit.plannedStart) : input.plannedStart
    const plannedEnd = input.plannedEnd === undefined ? day(audit.plannedEnd) : input.plannedEnd
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) {
      throw new DomainError(AuditErrors.AUDIT_DATES_INVALID, { plannedStart, plannedEnd })
    }

    const current: Record<AuditField, string | null> = {
      name: audit.name,
      introduction: audit.introduction,
      scopeNotes: audit.scopeNotes,
      objectives: audit.objectives,
      plannedStart: day(audit.plannedStart),
      plannedEnd: day(audit.plannedEnd),
    }
    const changed = (Object.keys(input) as AuditField[]).filter(
      (field) => input[field] !== undefined && input[field] !== current[field],
    )

    if (changed.length > 0) {
      await this.tx.audit.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.introduction !== undefined && { introduction: input.introduction }),
          ...(input.scopeNotes !== undefined && { scopeNotes: input.scopeNotes }),
          ...(input.objectives !== undefined && { objectives: input.objectives }),
          ...(input.plannedStart !== undefined && {
            plannedStart: input.plannedStart ? new Date(input.plannedStart) : null,
          }),
          ...(input.plannedEnd !== undefined && { plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : null }),
        },
      })
      await this.events.publish(AuditEvents.AuditUpdated, { auditId: id, changed })
    }
    return withAccess(await loadAuditView(this.tx, id), actor, access)
  }
}
