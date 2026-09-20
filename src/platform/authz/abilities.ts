import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability'
import { Role } from '../../shared/enums.js'

/**
 * ÚNICA fuente de los permisos GLOBALES por rol de sistema. El frontend recibe estas mismas reglas (empaquetadas con
 * `packRules`, ver `GET /profile`) y reconstruye su propia `Ability`: no reimplementa nada.
 *
 * Son permisos gruesos. Los que dependen de la auditoría concreta (¿es líder de ESTA auditoría?) viven en
 * `audits/domain/audit-policy.ts`, no aquí.
 */
export const ACTIONS = ['manage', 'create', 'read', 'update', 'delete'] as const
export type Action = (typeof ACTIONS)[number]

export const SUBJECTS = [
  'User',
  'Organization',
  'Template', // incluye controles y hallazgos sugeridos
  'Scale', // incluye sus niveles
  'Audit', // incluye el alcance
  'AuditMember',
  'Evaluation',
  'Evidence',
  'Report',
  'Dashboard',
] as const
export type Subject = (typeof SUBJECTS)[number] | 'all'

export type AppAbility = MongoAbility<[Action, Subject]>

interface Grant {
  readonly actions: readonly Action[]
  readonly subjects: readonly Subject[]
}

/** Los permisos como DATO: leer la tabla es leer la política. */
const GRANTS: Readonly<Record<Role, readonly Grant[]>> = {
  ADMIN: [{ actions: ['manage'], subjects: ['all'] }],

  GERENTE: [
    { actions: ['manage'], subjects: ['Audit', 'AuditMember', 'Evaluation', 'Evidence', 'Report'] },
    { actions: ['manage'], subjects: ['Template', 'Scale', 'Organization'] },
    { actions: ['read'], subjects: ['User', 'Dashboard'] },
  ],

  AUDITOR: [
    { actions: ['read'], subjects: ['Audit', 'AuditMember', 'Report', 'Template', 'Scale', 'Dashboard'] },
    { actions: ['create', 'update', 'delete'], subjects: ['AuditMember'] },
    { actions: ['create', 'read', 'update'], subjects: ['Evaluation', 'Evidence'] },
    { actions: ['delete'], subjects: ['Evidence'] },
  ],
}

export function defineAbilityFor(roles: readonly Role[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)
  for (const role of roles) {
    for (const grant of GRANTS[role] ?? []) can([...grant.actions], [...grant.subjects])
  }
  return build()
}
