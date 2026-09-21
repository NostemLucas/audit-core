import { z } from 'zod'
import { Instant } from '../../../platform/http/index.js'
import { AuditRole } from '../../../shared/enums.js'

export const MemberView = z.object({
  id: z.uuid(),
  role: z.enum(AuditRole),
  user: z.object({ id: z.uuid(), name: z.string(), username: z.string() }),
  /** Cuántos criterios tiene asignados (un miembro con criterios asignados no se quita ni se hace líder). */
  assignedCount: z.int(),
  createdAt: Instant,
})

/** El manager arma el equipo (docs/06 §1): a quién agrega y con qué rol. */
export const AddMember = z.object({ userId: z.uuid(), role: z.enum(AuditRole) })
export type AddMemberT = z.infer<typeof AddMember>

export const ChangeMemberRole = z.object({ role: z.enum(AuditRole) })
export type ChangeMemberRoleT = z.infer<typeof ChangeMemberRole>

export const MemberId = z.uuid()
