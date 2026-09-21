/**
 * El reloj del sistema, inyectable. Todo lo que depende de "ahora" (año del código de auditoría, `closedAt`, plazos) lo pide
 * aquí en lugar de llamar a `new Date()`, para poder fijar la hora en las pruebas.
 */
export interface Clock {
  now(): Date
}

export const CLOCK = Symbol('CLOCK')

export const systemClock: Clock = { now: () => new Date() }
