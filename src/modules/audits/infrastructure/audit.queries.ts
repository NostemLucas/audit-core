import type { Prisma } from '../../../generated/prisma/client.js'
import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { Role, type AuditRole } from '../../../shared/enums.js'
import { type Actor, type AuditAccess } from '../domain/audit-policy.js'
import { AuditErrors } from '../domain/errors.js'

/** Lo que una vista de auditoría muestra de las otras tablas (lecturas de listado: pueden unir tablas de varios módulos). */
export const AUDIT_INCLUDE = {
  organization: { select: { id: true, name: true } },
  template: { select: { id: true, name: true } },
  scale: { select: { id: true, name: true, dimension: true } },
  manager: { select: { id: true, name: true } },
  previousAudit: { select: { id: true, code: true, name: true } },
  scopeItems: { select: { id: true, name: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  _count: { select: { evaluations: true } },
} satisfies Prisma.AuditInclude

/**
 * Qué auditorías puede VER este actor (docs/06 §1): ADMIN y GERENTE todas; cualquier otro, solo donde es manager o
 * miembro. Única fuente de esta parte de la política, tanto para el listado como para el dashboard (`05` Fase 5).
 */
export function visibleAuditsWhere(actor: Actor): Prisma.AuditWhereInput {
  const seesAll = actor.roles.includes(Role.ADMIN) || actor.roles.includes(Role.GERENTE)
  if (seesAll) return {}
  return { OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] }
}

export async function loadAudit(tx: Tx, id: string) {
  const audit = await tx.audit.findUnique({ where: { id } })
  if (!audit) throw new DomainError(AuditErrors.AUDIT_NOT_FOUND, { id })
  return audit
}

export async function loadAuditView(tx: Tx, id: string) {
  const audit = await tx.audit.findUnique({ where: { id }, include: AUDIT_INCLUDE })
  if (!audit) throw new DomainError(AuditErrors.AUDIT_NOT_FOUND, { id })
  return audit
}

export async function memberRoleOf(tx: Tx, auditId: string, userId: string): Promise<AuditRole | null> {
  const member = await tx.auditMember.findUnique({
    where: { auditId_userId: { auditId, userId } },
    select: { role: true },
  })
  return member?.role ?? null
}

/** El acceso del actor a UNA auditoría: quién es su manager y qué rol tiene en el equipo. */
export async function accessOf(tx: Tx, actor: Actor, audit: { id: string; managerId: string }): Promise<AuditAccess> {
  return { managerId: audit.managerId, memberRole: await memberRoleOf(tx, audit.id, actor.id) }
}

/** Los usuarios de Nextcloud (username) de todo el equipo actual — para revocar/ajustar sus shares (docs/07 §1.5). */
export async function teamUsernames(tx: Tx, auditId: string): Promise<readonly string[]> {
  const members = await tx.auditMember.findMany({
    where: { auditId },
    select: { user: { select: { username: true } } },
  })
  return members.map((m) => m.user.username)
}

/** El acceso del actor a VARIAS auditorías con una sola consulta (para los listados). */
export async function accessesOf(
  tx: Tx,
  actor: Actor,
  audits: ReadonlyArray<{ id: string; managerId: string }>,
): Promise<ReadonlyMap<string, AuditAccess>> {
  const memberships = await tx.auditMember.findMany({
    where: { userId: actor.id, auditId: { in: audits.map((audit) => audit.id) } },
    select: { auditId: true, role: true },
  })
  const roleByAudit = new Map(memberships.map((m) => [m.auditId, m.role] as const))
  return new Map(
    audits.map((audit) => [audit.id, { managerId: audit.managerId, memberRole: roleByAudit.get(audit.id) ?? null }]),
  )
}
