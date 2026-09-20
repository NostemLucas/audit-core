import { z } from 'zod'

/**
 * Un instante en una vista de salida: el use case devuelve la fila tal cual (con `Date`) y el esquema la entrega como
 * texto ISO 8601. Es lo que evita escribir un mapper fila → vista por cada recurso (otra copia de la lista de campos).
 * El OpenAPI lo documenta como `string` con formato `date-time`.
 */
export const Instant = z.codec(z.date(), z.iso.datetime(), {
  decode: (date) => date.toISOString(),
  encode: (text) => new Date(text),
})
