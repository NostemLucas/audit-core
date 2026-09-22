import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module.js'
import { configureApp } from './configure-app.js'
import { ENV, type Env } from './platform/config/index.js'
import { AppLogger } from './platform/logging/index.js'

// Un entorno inválido falla aquí, en NestFactory.create (el proveedor ENV lo valida al instanciarse).
// `bufferLogs` retiene los logs del arranque hasta tener el logger propio, para que salgan todos por el mismo canal.
// `rawBody: true` deja los bytes crudos en `request.rawBody` (webhook de Nextcloud: la firma es sobre el cuerpo sin
// parsear, docs/07 §1.2), sin montar un body-parser propio.
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true })
const logger = app.get(AppLogger)
app.useLogger(logger)

const env = app.get<Env>(ENV)
configureApp(app, env)
await app.listen(env.PORT)
logger.for('Bootstrap').info('Servidor escuchando', { port: env.PORT, env: env.NODE_ENV })
