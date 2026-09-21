import { DomainError } from '../../../platform/errors/index.js'
import { AuditRole, Role } from '../../../shared/enums.js'
import { AuditErrors } from './errors.js'

/**
 * Permisos CONTEXTUALES: los que dependen de esta auditoría (¿soy su manager? ¿su líder? ¿el auditor asignado?). Función pura,
 * sin BD. Los permisos globales por rol de sistema viven en `platform/authz/abilities.ts` y deciden si la ruta se puede llamar;
 * estos deciden si se puede hacer SOBRE esta auditoría. La tabla de quién puede qué está en docs/06 §1.
 *
 * No hay superusuario: el ADMIN administra la plataforma y puede VER cualquier auditoría, pero no actúa sobre su contenido (una
 * sola excepción, transferirla a otro manager, que se agrega con esa operación). Quien deba poder gestionar una auditoría es su
 * manager; los roles globales se suman, así que una persona con ADMIN y GERENTE gestiona las que ella dirige, como manager.
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

/**
 * `read`: ver. `manage`: editar, alcance, equipo, iniciar, cerrar, archivar (el manager). `lead`: asignar criterios, nivel
 * esperado y guía, y revisar (el líder).
 */
export type AuditAction = 'read' | 'manage' | 'lead'

export function canOnAudit(action: AuditAction, actor: Actor, access: AuditAccess): boolean {
  switch (action) {
    case 'read':
      return (
        actor.roles.includes(Role.ADMIN) ||
        actor.roles.includes(Role.GERENTE) ||
        access.managerId === actor.id ||
        access.memberRole !== null
      )
    case 'manage':
      return access.managerId === actor.id
    case 'lead':
      return access.memberRole === AuditRole.LEAD
  }
}

/**
 * ¿Puede evaluar (editar, enviar a revisión) este criterio? Solo el AUDITOR (`MEMBER`) al que está asignado. El líder revisa y
 * no evalúa: quien revisa no revisa su propio trabajo.
 */
export function canEvaluate(actor: Actor, access: AuditAccess, assignedUserId: string | null): boolean {
  return access.memberRole === AuditRole.MEMBER && assignedUserId === actor.id
}

const REQUIRED = { read: 'MEMBER', manage: 'MANAGER', lead: 'LEAD' } as const

export function assertOnAudit(action: AuditAction, actor: Actor, access: AuditAccess): void {
  if (!canOnAudit(action, actor, access))
    throw new DomainError(AuditErrors.AUDIT_ACCESS_DENIED, { required: REQUIRED[action] })
}

export function assertCanEvaluate(actor: Actor, access: AuditAccess, assignedUserId: string | null): void {
  if (!canEvaluate(actor, access, assignedUserId)) {
    throw new DomainError(AuditErrors.AUDIT_ACCESS_DENIED, { required: 'ASSIGNED_MEMBER' })
  }
}
