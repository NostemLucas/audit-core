import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { assertAuditEditable } from '../domain/audit.lifecycle.js'
import { type Actor, assertOnAudit } from '../domain/audit-policy.js'
import { AuditErrors } from '../domain/errors.js'
import { accessOf, loadAudit } from '../infrastructure/audit.queries.js'

/**
 * Lo que exige cambiar el alcance (docs/01 §3): ser el manager, que la auditoría esté en borrador, y que no traslade
 * criterios de una auditoría anterior (lo trasladado vale para ESE alcance; docs/06 §9). Un seguimiento que evalúa todo de
 * nuevo sí puede cambiarlo.
 */
export async function editableScope(tx: Tx, actor: Actor, auditId: string): Promise<void> {
  const audit = await loadAudit(tx, auditId)
  assertOnAudit('manage', actor, await accessOf(tx, actor, audit))
  assertAuditEditable(audit.status)
  if ((await tx.evaluation.count({ where: { auditId, carriedFromId: { not: null } } })) > 0) {
    throw new DomainError(AuditErrors.AUDIT_SCOPE_INHERITED, { auditId })
  }
}

export function listScope(tx: Tx, auditId: string) {
  return tx.auditScopeItem.findMany({
    where: { auditId },
    select: { id: true, name: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}
