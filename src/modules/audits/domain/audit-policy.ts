import { DomainError } from '../../../platform/errors/index.js'
import { AuditRole, Role } from '../../../shared/enums.js'
import { AuditErrors } from './errors.js'

/**
 * Permisos CONTEXTUALES: los que dependen de esta auditoría (¿soy su manager? ¿su líder? ¿el inspector asignado?). Función
 * pura, sin BD. Los permisos globales por rol de sistema viven en `platform/authz/abilities.ts` y deciden si la ruta se puede
 * llamar; estos deciden si se puede hacer SOBRE esta auditoría. La tabla de quién puede qué está en docs/06 §1.
 *
 * El ADMIN lo puede todo. El GERENTE (global) puede VER cualquier auditoría, pero no gestionarla: eso es del manager.
 */
export interface Actor {
  readonly id: string
  readonly roles: readonly Role[]
}

export interface AuditAccess {
  readonly managerId: string
  /** El rol del actor en el equipo de ESTA auditoría, o `null` si no es miembro. */
  readonly memberRole: AuditRole | null
}

/** `read`: ver. `manage`: editar, iniciar, cerrar, archivar, designar al líder. `lead`: equipo de inspectores, niveles esperados, revisar. */
export type AuditAction = 'read' | 'manage' | 'lead'

const isAdmin = (actor: Actor): boolean => actor.roles.includes(Role.ADMIN)

export function canOnAudit(action: AuditAction, actor: Actor, access: AuditAccess): boolean {
  if (isAdmin(actor)) return true
  switch (action) {
    case 'read':
      return actor.roles.includes(Role.GERENTE) || access.managerId === actor.id || access.memberRole !== null
    case 'manage':
      return access.managerId === actor.id
    case 'lead':
      return access.memberRole === AuditRole.LEAD_AUDITOR
  }
}

/** ¿Puede evaluar (editar, completar) este criterio? El líder revisa, no evalúa: solo el inspector al que está asignado. */
export function canEvaluate(actor: Actor, access: AuditAccess, assignedUserId: string | null): boolean {
  if (isAdmin(actor)) return true
  return access.memberRole === AuditRole.INSPECTOR && assignedUserId === actor.id
}

const REQUIRED = { read: 'MEMBER', manage: 'MANAGER', lead: 'LEAD_AUDITOR' } as const

export function assertOnAudit(action: AuditAction, actor: Actor, access: AuditAccess): void {
  if (!canOnAudit(action, actor, access))
    throw new DomainError(AuditErrors.AUDIT_ACCESS_DENIED, { required: REQUIRED[action] })
}

export function assertCanEvaluate(actor: Actor, access: AuditAccess, assignedUserId: string | null): void {
  if (!canEvaluate(actor, access, assignedUserId)) {
    throw new DomainError(AuditErrors.AUDIT_ACCESS_DENIED, { required: 'ASSIGNED_INSPECTOR' })
  }
}
