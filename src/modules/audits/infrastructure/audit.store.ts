import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../platform/clock/index.js'
import { InjectTx, type Tx, versionConflict } from '../../../platform/db/index.js'
import { EventBus } from '../../../platform/events/index.js'
import type { Actor } from '../domain/audit-policy.js'
import type { AuditDecision, AuditState } from '../domain/audit.decider.js'
import { accessOf, loadAuditForUpdate, loadAuditView, teamUsernames } from './audit.queries.js'
import { TeamFolderProvisioningService } from './team-folder-provisioning.service.js'

/**
 * El ÚNICO camino para aplicar un comando del decider de `Audit` (`domain/audit.decider.ts`). Hace, en este orden y
 * siempre igual, lo que antes repetía cada caso de uso:
 *
 *  1. `loadAuditForUpdate`: el candado de la auditoría, ANTES que cualquier otra fila (docs/06 §10) — mismo orden que
 *     usa `EvaluationStore`: evita el deadlock de Postgres de fase-5m (una transacción que ya tiene bloqueada una fila
 *     de `evaluations` y quiere la de `audits`, contra otra que tiene la de `audits` y quiere la de `evaluations`).
 *  2. Carga el estado completo que el decider necesita (equipo, niveles esperados, asignación, pendientes).
 *  3. Decide (puro).
 *  4. Escribe con compare-and-swap sobre la VERSIÓN leída — igual que `EvaluationStore`, defensa además del candado.
 *  5. Si el comando lo pidió (`lockTeamReports`), baja los informes del equipo a solo lectura en Nextcloud.
 *  6. Publica el evento de la decisión, en la misma transacción — nunca antes de que la escritura haya tenido éxito.
 *
 * Quien llama pone `@Transactional()`: el store no abre transacciones, participa de la del caso de uso.
 */
@Injectable()
export class AuditStore {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly folders: TeamFolderProvisioningService,
  ) {}

  async execute(actor: Actor, auditId: string, decide: (state: AuditState) => AuditDecision) {
    const audit = await loadAuditForUpdate(this.tx, auditId)
    const [access, leadCount, memberCount, missingExpectedLevel, unassignedEvaluations, pendingEvaluations] =
      await Promise.all([
        accessOf(this.tx, actor, audit),
        this.tx.auditMember.count({ where: { auditId, role: 'LEAD' } }),
        this.tx.auditMember.count({ where: { auditId, role: 'MEMBER' } }),
        this.tx.evaluation.count({ where: { auditId, expectedLevelId: null } }),
        // Los trasladados de la auditoría anterior ya nacen aprobados: no hay nadie a quien asignarlos.
        this.tx.evaluation.count({ where: { auditId, assignedUserId: null, carriedFromId: null } }),
        this.tx.evaluation.count({ where: { auditId, status: { not: 'APPROVED' } } }),
      ])

    const { to, event, lockTeamReports } = decide({
      auditId,
      status: audit.status,
      access,
      leadCount,
      memberCount,
      missingExpectedLevel,
      unassignedEvaluations,
      pendingEvaluations,
    })

    const { count } = await this.tx.audit.updateMany({
      where: { id: auditId, version: audit.version },
      data: { status: to, ...(to === 'CLOSED' && { closedAt: this.clock.now() }) },
    })
    if (count === 0) throw versionConflict('Audit', auditId, audit.version)

    if (lockTeamReports) await this.folders.lockReports(audit.code, await teamUsernames(this.tx, auditId))
    await this.events.publish(event.def, event.payload)

    return { view: await loadAuditView(this.tx, auditId), access }
  }
}
