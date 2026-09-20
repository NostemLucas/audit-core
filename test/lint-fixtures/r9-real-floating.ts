import type { Db } from '../../src/platform/db/index.js'
import type { EventBus } from '../../src/platform/events/index.js'
import type { EventDef } from '../../src/platform/events/index.js'
import type { AppLogger } from '../../src/platform/logging/index.js'
import type { ClsService } from 'nestjs-cls'

/** Cada línea marcada FLOTA una promesa de verdad en nuestro código: sin await, el error se pierde o el rollback no ocurre. */
export async function forgetfulUseCase(db: Db, bus: EventBus, event: EventDef<'X', { a: number }>, cls: ClsService): Promise<void> {
  db.organization.create({ data: { name: 'x' } }) // (1) llamada Prisma a través de $extends: PrismaPromise
  bus.publish(event, { a: 1 }) // (2) el bus de eventos: si no se espera, el rollback deja de cubrir al handler
  db.$transaction(async (tx) => tx.organization.count()) // (3) transacción interactiva
  cls.run(async () => 1) // (4) contexto ambiental
  const created = db.scale.create({ data: { name: 'y' } }) // (5) guardada en una variable y NUNCA esperada
  void created.then
}

export async function correctUseCase(db: Db, bus: EventBus, event: EventDef<'X', { a: number }>): Promise<number> {
  await db.organization.create({ data: { name: 'x' } })
  await bus.publish(event, { a: 1 })
  const [count] = await Promise.all([db.organization.count()])
  void db.organization.count() // descartada a propósito y explícito: NO debe marcarse
  return count
}
