import { applyDecorators, SerializeOptions } from '@nestjs/common'
import { ApiResponse } from '@nestjs/swagger'
import { z } from 'zod'

export const PageMetaSchema = z.object({
  page: z.int(),
  pageSize: z.int(),
  total: z.int(),
  totalPages: z.int(),
})

export type RespondsKind = 'one' | 'list' | 'page'

/**
 * Declara UNA vez el esquema de salida de un endpoint. De ahí salen las dos cosas que deben coincidir:
 *  - la serialización real (recorta campos y valida cada ítem), y
 *  - el OpenAPI, que documenta el envelope tal como llega al cliente: `{ data }` o `{ data, meta }`.
 *
 * `schema` describe UN ítem. `kind`: 'one' (por defecto), 'list' (array) o 'page' (array + meta).
 */
export function Responds(schema: z.ZodType, options: { kind?: RespondsKind; status?: number } = {}): MethodDecorator {
  const { kind = 'one', status = 200 } = options
  const documented =
    kind === 'one'
      ? z.object({ data: schema })
      : kind === 'list'
        ? z.object({ data: z.array(schema) })
        : z.object({ data: z.array(schema), meta: PageMetaSchema })

  return applyDecorators(SerializeOptions({ schema }), ApiResponse({ status, standardSchema: documented }))
}
