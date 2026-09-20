import { InjectTransaction, Transactional, type Transaction } from '@nestjs-cls/transactional'
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma'
import type { Db } from './create-db.js'

export { DB, DbModule } from './db.module.js'
export { createDb } from './create-db.js'
export type { Db } from './create-db.js'

/**
 * Cómo escribe un caso de uso en la BD:
 *
 *   @Transactional()                       // abre la transacción (solo en métodos que escriben)
 *   async execute(...) {
 *     await this.tx.organization.create(…) // `tx` = cliente transaccional si hay transacción; si no, el normal
 *   }
 *
 *   constructor(@InjectTx() private readonly tx: Tx) {}
 */
export type Tx = Transaction<TransactionalAdapterPrisma<Db>>
export const InjectTx = InjectTransaction
export { Transactional }
