import { auditLifecycle } from '../domain/audit.lifecycle.js'
import { type Actor, type AuditAccess, canOnAudit, canTransfer } from '../domain/audit-policy.js'

/**
 * Lo derivado que el cliente necesita de una auditoría, junto a su fila: lo que puede hacer ahora (ciclo de vida ∩ permisos
 * del actor, docs/03 regla 12) y sus permisos contextuales. Única traducción fila → vista: el resto lo da el esquema.
 */
export function withAccess<
  T extends { status: Parameters<typeof auditLifecycle.allowed>[0]; _count: { evaluations: number } },
>(row: T, actor: Actor, access: AuditAccess) {
  const { _count, ...rest } = row
  const manage = canOnAudit('manage', actor, access)
  return {
    ...rest,
    evaluationCount: _count.evaluations,
    allowedActions: manage ? auditLifecycle.allowed(row.status) : [],
    permissions: { manage, lead: canOnAudit('lead', actor, access), transfer: canTransfer(actor) },
  }
}
