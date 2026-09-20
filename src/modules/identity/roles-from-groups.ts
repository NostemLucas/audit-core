import { Role } from '../../shared/enums.js'

/**
 * Convención de nombres de los GRUPOS de Authentik → roles del sistema (misma regla que el proyecto anterior):
 *   contiene "admin"                 → ADMIN
 *   contiene "gerente" o "manager"   → GERENTE
 *   contiene "auditor"               → AUDITOR
 * Cada grupo aporta a lo sumo un rol y se evalúa por orden (un grupo "auditor-admin" da ADMIN, no AUDITOR). Un usuario
 * puede tener varios roles si está en varios grupos. Sin grupos reconocidos → sin roles (se autentica pero no puede
 * nada, salvo `GET /profile`).
 */
const ORDER: readonly Role[] = [Role.ADMIN, Role.GERENTE, Role.AUDITOR]

function roleOf(group: string): Role | undefined {
  const name = group.toLowerCase()
  if (name.includes('admin')) return Role.ADMIN
  if (name.includes('gerente') || name.includes('manager')) return Role.GERENTE
  if (name.includes('auditor')) return Role.AUDITOR
  return undefined
}

/** Roles sin repetir y en orden fijo, para que dos sincronizaciones iguales den exactamente el mismo resultado. */
export function rolesFromGroups(groups: readonly string[]): Role[] {
  const found = new Set(groups.map(roleOf).filter((role): role is Role => role !== undefined))
  return ORDER.filter((role) => found.has(role))
}
