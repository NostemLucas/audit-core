import { Global, Module } from '@nestjs/common'
import { ClsPluginTransactional } from '@nestjs-cls/transactional'
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma'
import { ClsModule } from 'nestjs-cls'
import { DB, DbModule } from '../db/db.module.js'
import { ContextRunner } from './context-runner.js'
import './cls-store.js'

/**
 * Contexto ambiental por unidad de trabajo (CLS) + transacciones declarativas. NO sabe de HTTP:
 *  - Quien abre el contexto es el PUNTO DE ENTRADA: en HTTP, `platform/http` monta el middleware (ver `configure-app.ts`);
 *    en jobs y seeds, `ContextRunner`.
 *  - `@Transactional()` abre una transacción; dentro, `@InjectTx()` resuelve al cliente transaccional.
 */
const cls = ClsModule.forRoot({
  global: true,
  plugins: [
    new ClsPluginTransactional({
      imports: [DbModule],
      enableTransactionProxy: true,
      adapter: new TransactionalAdapterPrisma({ prismaInjectionToken: DB }),
    }),
  ],
})

@Global()
@Module({ imports: [cls], providers: [ContextRunner], exports: [ContextRunner] })
export class ContextModule {}
