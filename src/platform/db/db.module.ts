import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import '../context/cls-store.js'
import { ENV, type Env } from '../config/index.js'
import { createDb, type Db } from './create-db.js'

/** Token del cliente de BD: `@Inject(DB) db: Db`. Para escribir en casos de uso, ver `InjectTx` en `index.ts`. */
export const DB = Symbol('DB')

@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect()
  }
}

/** Prisma conecta de forma perezosa: la app arranca aunque la BD no responda; `/health/ready` es quien lo informa. */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV, ClsService],
      useFactory: (env: Env, cls: ClsService): Db => createDb(env.DATABASE_URL, () => cls.get('userId')),
    },
    DbLifecycle,
  ],
  exports: [DB],
})
export class DbModule {}
