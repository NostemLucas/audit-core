import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino'
import { REDACTED_CENSOR, REDACTED_PATHS } from './redaction.js'
import { serializeError } from './serialize-error.js'

export interface AmbientContext {
  correlationId?: string | undefined
  userId?: string | undefined
}

export interface CreatePinoOptions {
  readonly level: string
  readonly pretty: boolean
  /** Lee el contexto ambiental. Se llama en CADA línea; puede devolver vacío fuera de una unidad de trabajo. */
  readonly getContext: () => AmbientContext
  /** Solo para pruebas: captura la salida en lugar de escribir en stdout. */
  readonly destination?: DestinationStream | undefined
}

/**
 * Crea el logger base. No sabe de HTTP ni de Nest: lo único ambiental que conoce es `getContext()`, que le da
 * `correlationId` y `userId` (quien los fije, sea HTTP, un job o un seed, es asunto de otro).
 */
export function createPino(options: CreatePinoOptions): PinoLogger {
  const base: pino.LoggerOptions = {
    level: options.level,
    base: { service: 'audit-core' },
    messageKey: 'msg',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACTED_PATHS], censor: REDACTED_CENSOR },
    serializers: { err: serializeError },
    mixin: () => {
      const { correlationId, userId } = options.getContext()
      return { ...(correlationId && { correlationId }), ...(userId && { userId }) }
    },
  }

  if (options.destination) {
    return pino({ ...base, formatters: { level: (label) => ({ level: label }) } }, options.destination)
  }
  if (options.pretty) {
    // Con `transport`, pino no admite `formatters.level`; la salida legible ya muestra el nombre del nivel.
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
      },
    })
  }
  return pino({ ...base, formatters: { level: (label) => ({ level: label }) } })
}
