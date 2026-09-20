import { describe, expect, it } from 'vitest'
import { DomainError, defineErrors } from '../errors/index.js'
import { AppLogger } from './app-logger.js'
import { createPino, type AmbientContext } from './create-pino.js'
import { REDACTED_PATHS } from './redaction.js'
import { serializeError } from './serialize-error.js'

const Errors = defineErrors({ LOGGING_TEST_CONFLICT: { http: 409, message: 'Conflicto de prueba' } })

/** Captura las líneas que pino escribiría, ya parseadas. */
function capture(options: { level?: string; context?: AmbientContext } = {}) {
  const chunks: string[] = []
  const pino = createPino({
    level: options.level ?? 'trace',
    pretty: false,
    getContext: () => options.context ?? {},
    destination: { write: (line: string) => void chunks.push(line) },
  })
  return {
    logger: new AppLogger(pino),
    lines: () => chunks.map((line) => JSON.parse(line) as Record<string, any>),
    raw: () => chunks.join(''),
  }
}

describe('formato de las líneas', () => {
  it('JSON con nivel como texto, hora ISO, mensaje y servicio; sin pid ni hostname', () => {
    const { logger, lines } = capture()
    logger.for('Demo').info('Auditoría iniciada', { auditId: 'a-1' })
    const [line] = lines()
    expect(line).toMatchObject({
      level: 'info',
      msg: 'Auditoría iniciada',
      service: 'audit-core',
      context: 'Demo',
      auditId: 'a-1',
    })
    expect(line?.['time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(line).not.toHaveProperty('pid')
    expect(line).not.toHaveProperty('hostname')
  })

  it('respeta el nivel mínimo', () => {
    const { logger, lines } = capture({ level: 'warn' })
    const log = logger.for('Demo')
    log.debug('no sale')
    log.info('no sale')
    log.warn('sale')
    log.error('sale')
    expect(lines().map((l) => l['level'])).toEqual(['warn', 'error'])
  })

  it('`at` escribe al nivel dado en tiempo de ejecución', () => {
    const { logger, lines } = capture()
    logger.for('Demo').at('warn', 'dinámico', { x: 1 })
    expect(lines()[0]).toMatchObject({ level: 'warn', msg: 'dinámico', x: 1 })
  })
})

describe('contexto ambiental (sin saber de dónde viene)', () => {
  it('agrega correlationId y userId a cada línea, sin pasarlos a mano', () => {
    const { logger, lines } = capture({ context: { correlationId: 'job-x:1', userId: 'u-1' } })
    logger.for('Demo').info('algo')
    expect(lines()[0]).toMatchObject({ correlationId: 'job-x:1', userId: 'u-1' })
  })

  it('sin contexto (arranque, seeds) la línea sale igual, sin esos campos', () => {
    const { logger, lines } = capture({ context: {} })
    logger.for('Demo').info('algo')
    expect(lines()[0]).not.toHaveProperty('correlationId')
    expect(lines()[0]).not.toHaveProperty('userId')
  })
})

describe('redacción de secretos', () => {
  it('censura los campos sensibles, en el nivel superior y anidados', () => {
    const { logger, lines, raw } = capture()
    logger.for('Demo').info('datos', {
      password: 'hunter2',
      token: 'tok-secreto',
      headers: { authorization: 'Bearer abc.def.ghi', cookie: 'sid=zzz', accept: 'json' },
      user: { name: 'Ana', clientSecret: 'cs-secreto' },
    })
    const line = lines()[0]!
    expect(line['password']).toBe('[REDACTED]')
    expect(line['token']).toBe('[REDACTED]')
    expect(line['headers'].authorization).toBe('[REDACTED]')
    expect(line['headers'].cookie).toBe('[REDACTED]')
    expect(line['user'].clientSecret).toBe('[REDACTED]')
    for (const secret of ['hunter2', 'tok-secreto', 'abc.def.ghi', 'sid=zzz', 'cs-secreto'])
      expect(raw()).not.toContain(secret)
  })

  it('no censura lo que no es sensible', () => {
    const { logger, lines } = capture()
    logger.for('Demo').info('datos', { headers: { accept: 'json' }, user: { name: 'Ana' } })
    expect(lines()[0]).toMatchObject({ headers: { accept: 'json' }, user: { name: 'Ana' } })
  })

  it('la lista de campos sensibles cubre las cabeceras y credenciales habituales', () => {
    for (const key of ['authorization', 'cookie', 'password', 'token', 'jwt', 'clientSecret'])
      expect(REDACTED_PATHS).toContain(key)
  })
})

describe('errores', () => {
  it('un error en `err` sale con tipo, mensaje y stack', () => {
    const { logger, lines } = capture()
    logger.for('Demo').error('Falló la generación', { err: new TypeError('boom'), auditId: 'a-1' })
    const line = lines()[0]!
    expect(line['err']).toMatchObject({ type: 'TypeError', message: 'boom' })
    expect(line['err'].stack).toContain('TypeError: boom')
    expect(line['auditId']).toBe('a-1')
  })

  it('un DomainError incluye code y details', () => {
    const error = new DomainError(Errors.LOGGING_TEST_CONFLICT, { name: 'ACME' })
    expect(serializeError(error)).toMatchObject({
      type: 'DomainError',
      code: 'LOGGING_TEST_CONFLICT',
      details: { name: 'ACME' },
    })
  })

  it('sigue la cadena de causas', () => {
    const root = new Error('raíz')
    const middle = new Error('medio', { cause: root })
    const top = new DomainError(Errors.LOGGING_TEST_CONFLICT, undefined, { cause: middle })
    const out = serializeError(top)
    expect(out.cause?.message).toBe('medio')
    expect(out.cause?.cause?.message).toBe('raíz')
  })

  it('LISTA BLANCA: nunca vuelca propiedades extra (p. ej. la fila que trae un error de Prisma en `meta`)', () => {
    const prismaLike = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { driverAdapterError: { cause: { detail: 'Failing row contains (ana@secreta.com, 12345678)' } } },
    })
    const { logger, raw } = capture()
    logger.for('Demo').error('BD', { err: prismaLike })
    expect(raw()).toContain('Unique constraint failed')
    expect(raw()).not.toMatch(/ana@secreta\.com|12345678|Failing row/)
  })

  it('trunca mensajes enormes y limita la profundidad de causas', () => {
    expect(serializeError(new Error('x'.repeat(10_000))).message.length).toBe(2_000)
    let error = new Error('nivel 0')
    for (let i = 1; i <= 20; i++) error = new Error(`nivel ${i}`, { cause: error })
    let depth = 0
    for (let e = serializeError(error).cause; e; e = e.cause) depth++
    expect(depth).toBeLessThanOrEqual(5)
  })

  it('algo que no es un Error también se serializa', () => {
    expect(serializeError('texto suelto')).toEqual({ type: 'string', message: 'texto suelto' })
  })
})

describe('adaptador de LoggerService de Nest (logs internos del framework)', () => {
  it('log(mensaje, contexto) → info con contexto', () => {
    const { logger, lines } = capture()
    logger.log('Mapped route', 'RouterExplorer')
    expect(lines()[0]).toMatchObject({ level: 'info', msg: 'Mapped route', context: 'RouterExplorer' })
  })

  it('error(mensaje, stack, contexto) conserva el stack y el contexto', () => {
    const { logger, lines } = capture()
    logger.error('Falló', 'Error: falló\n    at algo (archivo.ts:1:1)', 'MiServicio')
    const line = lines()[0]!
    expect(line).toMatchObject({ level: 'error', msg: 'Falló', context: 'MiServicio' })
    expect(line['err'].stack).toContain('at algo')
  })

  it('error(mensaje, contexto) distingue un contexto de un stack', () => {
    const { logger, lines } = capture()
    logger.error('Falló', 'MiServicio')
    expect(lines()[0]).toMatchObject({ context: 'MiServicio' })
    expect(lines()[0]).not.toHaveProperty('err')
  })

  it('verbose → trace, debug → debug, warn → warn, fatal → fatal; un mensaje objeto se serializa', () => {
    const { logger, lines } = capture()
    logger.verbose('v')
    logger.debug('d')
    logger.warn('w')
    logger.fatal('f')
    logger.log({ clave: 'valor' })
    expect(lines().map((l) => l['level'])).toEqual(['trace', 'debug', 'warn', 'fatal', 'info'])
    expect(lines()[4]?.['msg']).toBe('{"clave":"valor"}')
  })
})
