import { defineErrors } from '../../platform/errors/index.js'

export const OrganizationErrors = defineErrors({
  ORGANIZATION_NOT_FOUND: { http: 404, message: 'Organización no encontrada' },
  ORGANIZATION_NAME_TAKEN: {
    http: 409,
    message: 'Ya existe una organización con ese nombre',
    onUnique: 'organizations_name_key',
  },
  /** Estándar de disponibilidad (docs/03): una organización inactiva no se elige para auditorías nuevas. */
  ORGANIZATION_INACTIVE: { http: 422, message: 'La organización está inactiva' },
  /** Tiene auditorías: se desactiva en lugar de borrar. */
  ORGANIZATION_IN_USE: {
    http: 409,
    message: 'La organización tiene auditorías; desactívala en lugar de eliminarla',
    onForeignKeyDelete: 'audits_organizationId_fkey',
  },
})
