import { Role } from '../../../shared/enums.js'

/**
 * Convención de nombres de los GRUPOS de Authentik → roles del sistema: el nombre del grupo debe ser EXACTAMENTE
 * (sin distinguir mayúsculas) uno de los roles que este sistema define — `ADMIN`, `GERENTE`, `AUDITOR`. Nada de
 * coincidencia parcial: un grupo como "authentik Admins" o un departamento "Administración" no matchea nada, no da
 * ADMIN por accidente. Quién decide qué es un rol es este sistema, no Authentik — si los nombres de grupo en
 * Authentik no coinciden, se corrige la configuración de Authentik, no la lógica de acá.
 * Un usuario puede tener varios roles si está en varios grupos con esos nombres exactos. Sin grupos reconocidos →
 * sin roles (se autentica pero no puede nada, salvo `GET /profile`).
 */
const ORDER: readonly Role[] = [Role.ADMIN, Role.GERENTE, Role.AUDITOR]
const ROLE_NAMES: ReadonlySet<string> = new Set(ORDER)

function roleOf(group: string): Role | undefined {
  const name = group.toUpperCase()
  return ROLE_NAMES.has(name) ? (name as Role) : undefined
}

/** Roles sin repetir y en orden fijo, para que dos sincronizaciones iguales den exactamente el mismo resultado. */
export function rolesFromGroups(groups: readonly string[]): Role[] {
  const found = new Set(groups.map(roleOf).filter((role): role is Role => role !== undefined))
  return ORDER.filter((role) => found.has(role))
}
