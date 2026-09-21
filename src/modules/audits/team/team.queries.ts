import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { assertAuditStaffable } from '../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../domain/audit-policy.js'
import { AuditErrors } from '../domain/errors.js'
import { accessOf, loadAudit } from '../infrastructure/audit.queries.js'

/** Lo que exige cambiar el equipo (docs/06 §1): ser el manager, y que la auditoría esté en borrador o en curso. */
export async function manageableTeam(tx: Tx, actor: Actor, auditId: string) {
  const audit = await loadAudit(tx, auditId)
  assertOnAudit('manage', actor, await accessOf(tx, actor, audit))
  assertAuditStaffable(audit.status)
  return audit
}

export async function loadMember(tx: Tx, auditId: string, memberId: string) {
  const member = await tx.auditMember.findFirst({ where: { id: memberId, auditId } })
  if (!member) throw new DomainError(AuditErrors.MEMBER_NOT_FOUND, { auditId, memberId })
  return member
}

/** Criterios de la auditoría que hoy tiene asignados ese usuario. */
export function assignedCount(tx: Tx, auditId: string, userId: string): Promise<number> {
  return tx.evaluation.count({ where: { auditId, assignedUserId: userId } })
}

/** El equipo con el nombre de cada uno y cuántos criterios tiene asignados (una sola consulta para los conteos). */
export async function listTeam(tx: Tx, auditId: string) {
  const [members, counts] = await Promise.all([
    tx.auditMember.findMany({
      where: { auditId },
      include: { user: { select: { id: true, name: true, username: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    tx.evaluation.groupBy({
      by: ['assignedUserId'],
      where: { auditId, assignedUserId: { not: null } },
      _count: { _all: true },
    }),
  ])
  const byUser = new Map(counts.map((row) => [row.assignedUserId, row._count._all] as const))
  return members.map((member) => ({ ...member, assignedCount: byUser.get(member.userId) ?? 0 }))
}
