import { Global, Module } from '@nestjs/common'
import { loadEnv } from './env.js'

/** Token de inyección del entorno ya validado: `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV')

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
