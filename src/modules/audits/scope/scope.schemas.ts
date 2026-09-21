import { z } from 'zod'
import { LIMITS } from '../../../shared/limits.js'

export const ScopeItemView = z.object({ id: z.uuid(), name: z.string() })

export const AddScopeItem = z.object({ name: z.string().trim().min(1).max(LIMITS.name) })
export type AddScopeItemT = z.infer<typeof AddScopeItem>

export const ScopeItemId = z.uuid()
