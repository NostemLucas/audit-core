import { Inject, Injectable, type LoggerService } from '@nestjs/common'
import type { Logger as PinoLogger } from 'pino'
import { PINO } from './tokens.js'

export type Fields = Readonly<Record<string, unknown>>

/**
 * API de logging del sistema. Reglas (docs/02 §13):
 *  - El MENSAJE es texto fijo, sin datos interpolados. Lo variable va en `fields`, donde se puede buscar y donde la
 *    redacción de secretos sí actúa.
 *  - Un error va en el campo `err`: `log.error('Falló la generación', { err, auditId })`.
 *  - El contexto ambiental (`correlationId`, `userId`) se agrega solo; no se pasa a mano.
 */
export interface Log {
  fatal(message: string, fields?: Fields): void
  error(message: string, fields?: Fields): void
  warn(message: string, fields?: Fields): void
  info(message: string, fields?: Fields): void
  debug(message: string, fields?: Fields): void
  trace(message: string, fields?: Fields): void
  /** Nivel dado en tiempo de ejecución (lo usa el log de acceso, que decide por estado HTTP). */
  at(level: 'error' | 'warn' | 'info', message: string, fields?: Fields): void
}

function toLog(pino: PinoLogger): Log {
  const write =
    (level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace') => (message: string, fields?: Fields) =>
      fields ? pino[level](fields, message) : pino[level](message)
  return {
    fatal: write('fatal'),
    error: write('error'),
    warn: write('warn'),
    info: write('info'),
    debug: write('debug'),
    trace: write('trace'),
    at: (level, message, fields) => write(level)(message, fields),
  }
}

const STACK_LINE = /\n\s+at /

/**
 * Logger de la aplicación. `for('Contexto')` devuelve un `Log` que marca cada línea con su origen. Además implementa
 * `LoggerService` de Nest para que los logs internos del framework (arranque, rutas) salgan por el mismo canal.
 */
@Injectable()
export class AppLogger implements LoggerService {
  constructor(@Inject(PINO) private readonly pino: PinoLogger) {}

  for(context: string): Log {
    return toLog(this.pino.child({ context }))
  }

  // ── LoggerService de Nest ────────────────────────────────────────────────
  log(message: unknown, ...rest: unknown[]): void {
    this.nest('info', message, rest)
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.nest('warn', message, rest)
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.nest('debug', message, rest)
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.nest('trace', message, rest)
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.nest('fatal', message, rest)
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.nest('error', message, rest)
  }

  /** Nest llama `(mensaje, contexto?)` y, para errores, `(mensaje, stack?, contexto?)`. */
  private nest(
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
    message: unknown,
    rest: unknown[],
  ): void {
    const strings = rest.filter((item): item is string => typeof item === 'string')
    let context: string | undefined
    let stack: string | undefined
    if (level === 'error' || level === 'fatal') {
      if (strings.length >= 2) [stack, context] = [strings[0], strings[strings.length - 1]]
      else if (strings.length === 1) STACK_LINE.test(strings[0]!) ? (stack = strings[0]) : (context = strings[0])
    } else {
      context = strings[strings.length - 1]
    }
    const text =
      typeof message === 'string' ? message : message instanceof Error ? message.message : JSON.stringify(message)
    const target = context ? this.pino.child({ context }) : this.pino
    if (stack) target[level]({ err: Object.assign(new Error(text), { stack }) }, text)
    else target[level](text)
  }
}
