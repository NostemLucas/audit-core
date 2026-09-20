import { z } from 'zod'

interface DecimalLike {
  toNumber(): number
}

/**
 * Un decimal de la BD (Prisma lo entrega como `Decimal`, que se serializaría como texto) que sale como número JSON.
 * Igual que `Instant`: el use case devuelve la fila y la vista de salida da formato, sin mapper. Solo para columnas
 * `Decimal(5,2)` (puntajes de las escalas), donde el número es exacto.
 */
export const DecimalNumber = z.codec(
  z.custom<DecimalLike>((value) => typeof (value as DecimalLike | null)?.toNumber === 'function'),
  z.number(),
  { decode: (decimal) => decimal.toNumber(), encode: (number) => ({ toNumber: () => number }) },
)
