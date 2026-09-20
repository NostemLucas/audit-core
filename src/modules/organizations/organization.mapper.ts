import type { OrganizationViewT } from './organization.schemas.js'

interface OrganizationRow {
  id: string
  name: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** Única traducción fila → vista (las fechas salen como ISO 8601). */
export function toOrganizationView(row: OrganizationRow): OrganizationViewT {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
