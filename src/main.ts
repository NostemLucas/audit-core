import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module.js'
import { configureApp } from './configure-app.js'
import { ENV, type Env } from './platform/config/index.js'

// Un entorno inválido falla aquí, en NestFactory.create (el proveedor ENV lo valida al instanciarse).
const app = await NestFactory.create<NestExpressApplication>(AppModule)
const env = app.get<Env>(ENV)
configureApp(app, env)
await app.listen(env.PORT)
new Logger('Bootstrap').log(`Escuchando en :${env.PORT} (${env.NODE_ENV})`)
