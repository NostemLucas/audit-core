import { z } from 'zod'

/**
 * El tamaño de un archivo: Prisma lo entrega como `bigint` (columna `BigInt`), que `JSON.stringify` no serializa. Sale
 * como número — un archivo de evidencia real nunca se acerca a `Number.MAX_SAFE_INTEGER` bytes (9 mil TB).
 */
export const ByteSize = z.codec(z.bigint(), z.number().int().nonnegative(), {
  decode: (value) => Number(value),
  encode: (value) => BigInt(value),
})
