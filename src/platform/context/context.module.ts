import { ClsModule } from 'nestjs-cls'
import { ClsPluginTransactional } from '@nestjs-cls/transactional'
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma'
import type { Response } from 'express'
import { DB } from '../db/db.module.js'
import { DbModule } from '../db/db.module.js'
import './cls-store.js'

/**
 * Contexto por petición (CLS) + transacciones declarativas.
 *  - `requestId` queda disponible para el logger sin pasarlo a mano.
 *  - `@Transactional()` abre una transacción; dentro, `@InjectTx()` resuelve al cliente transaccional. Fuera de
 *    una transacción resuelve al cliente normal.
 */
export const ContextModule = ClsModule.forRoot({
  global: true,
  middleware: {
    mount: true,
    setup: (cls, _req, res: Response) => {
      cls.set('requestId', String(res.locals['requestId'] ?? ''))
    },
  },
  plugins: [
    new ClsPluginTransactional({
      imports: [DbModule],
      enableTransactionProxy: true,
      adapter: new TransactionalAdapterPrisma({ prismaInjectionToken: DB }),
    }),
  ],
})
