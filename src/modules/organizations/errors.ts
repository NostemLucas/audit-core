import { defineErrors } from '../../platform/errors'

export const OrganizationErrors = defineErrors({
  ORGANIZATION_NOT_FOUND: { http: 404, message: 'Organización no encontrada' },
  ORGANIZATION_NAME_TAKEN: {
    http: 409,
    message: 'Ya existe una organización con ese nombre',
    onUnique: 'organizations_name_key',
  },
  /** Estándar de disponibilidad (docs/03): una organización inactiva no se elige para usos nuevos. */
  ORGANIZATION_INACTIVE: { http: 422, message: 'La organización está inactiva' },
  /** Bloqueada por auditorías O por activos; en ambos casos se desactiva en lugar de borrar. */
  ORGANIZATION_IN_USE: {
    http: 409,
    message: 'La organización tiene auditorías o activos; desactívala en lugar de eliminarla',
    onForeignKeyDelete: ['audits_organizationId_fkey', 'assets_organizationId_fkey'],
  },
  ASSET_NOT_FOUND: { http: 404, message: 'Activo no encontrado' },
  ASSET_INACTIVE: { http: 422, message: 'El activo está inactivo' },
  ASSET_NAME_TAKEN: {
    http: 409,
    message: 'La organización ya tiene un activo con ese nombre',
    onUnique: 'assets_organizationId_name_key',
  },
  ASSET_IN_USE: {
    http: 409,
    message: 'El activo forma parte del alcance de alguna auditoría; desactívalo en lugar de eliminarlo',
    onForeignKeyDelete: 'audit_assets_assetId_organizationId_fkey',
  },
})
