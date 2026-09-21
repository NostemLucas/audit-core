import { z } from 'zod'

/**
 * Una fecha de calendario (sin hora) en una vista de salida: columnas `Date` de la BD (`@db.Date`), que Prisma entrega como
 * `Date` a medianoche UTC. Sale como `AAAA-MM-DD`. Igual que `Instant`: el use case devuelve la fila y el esquema da formato.
 */
export const CalendarDate = z.codec(z.date(), z.iso.date(), {
  decode: (date) => date.toISOString().slice(0, 10),
  encode: (text) => new Date(`${text}T00:00:00.000Z`),
})
