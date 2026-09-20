import { EventEmitter } from 'node:events'
import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import type { Fields, Log } from '../logging/index.js'
import { accessLog } from './access-log.js'

interface Entry {
  level: string
  message: string
  fields: Fields
}

function fakeLog(): { log: Log; entries: Entry[] } {
  const entries: Entry[] = []
  const noop = () => undefined
  const log: Log = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    at: (level, message, fields) => void entries.push({ level, message, fields: fields ?? {} }),
  }
  return { log, entries }
}

/** Simula una petición que termina con `status`. `finished: false` simula una conexión cortada por el cliente. */
function run(options: { url?: string; status?: number; finished?: boolean; user?: unknown; route?: string; ignore?: string[] }) {
  const { log, entries } = fakeLog()
  const res = Object.assign(new EventEmitter(), {
    statusCode: options.status ?? 200,
    writableFinished: options.finished ?? true,
    locals: { requestId: 'trace-abc-12345' } as Record<string, unknown>,
    getHeader: (name: string) => (name === 'content-length' ? '128' : undefined),
  }) as unknown as Response
  const req = {
    method: 'GET',
    originalUrl: options.url ?? '/api/v1/audits',
    route: options.route ? { path: options.route } : undefined,
    user: options.user,
  } as unknown as Request
  let nextCalled = false
  accessLog(log, options.ignore ? { ignorePaths: options.ignore } : {})(req, res, () => void (nextCalled = true))
  res.emit('close')
  return { entries, nextCalled }
}

describe('log de acceso HTTP', () => {
  it('escribe UNA línea por petición, con método, ruta, estado, duración, bytes y correlationId', () => {
    const { entries, nextCalled } = run({ route: '/api/v1/audits/:id', url: '/api/v1/audits/42' })
    expect(nextCalled).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: 'info',
      message: 'Petición HTTP',
      fields: { method: 'GET', path: '/api/v1/audits/42', route: '/api/v1/audits/:id', status: 200, bytes: 128, correlationId: 'trace-abc-12345' },
    })
    expect(typeof entries[0]?.fields['durationMs']).toBe('number')
  })

  it.each([
    [200, 'info'],
    [302, 'info'],
    [404, 'warn'],
    [422, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('estado %i → nivel %s', (status, level) => {
    expect(run({ status }).entries[0]?.level).toBe(level)
  })

  it('NO registra el query string (puede llevar tokens o datos personales)', () => {
    const [entry] = run({ url: '/api/v1/audits?token=SECRETO&email=ana@x.com' }).entries
    expect(entry?.fields['path']).toBe('/api/v1/audits')
    expect(JSON.stringify(entry)).not.toMatch(/SECRETO|ana@x\.com/)
  })

  it('no registra el comodín interno de "ruta no encontrada" como si fuera una ruta', () => {
    expect(run({ route: '*path', status: 404 }).entries[0]?.fields).not.toHaveProperty('route')
  })

  it('omite los health checks (ruido) pero no el resto', () => {
    expect(run({ url: '/health/live' }).entries).toHaveLength(0)
    expect(run({ url: '/health/ready' }).entries).toHaveLength(0)
    expect(run({ url: '/api/v1/health-report' }).entries).toHaveLength(1)
  })

  it('las rutas ignoradas son configurables', () => {
    expect(run({ url: '/metrics', ignore: ['/metrics'] }).entries).toHaveLength(0)
  })

  it('marca las conexiones cortadas por el cliente', () => {
    expect(run({ finished: false }).entries[0]?.fields['aborted']).toBe(true)
    expect(run({ finished: true }).entries[0]?.fields).not.toHaveProperty('aborted')
  })

  it('incluye el usuario solo si la petición ya está autenticada', () => {
    expect(run({ user: { id: 'user-7' } }).entries[0]?.fields['userId']).toBe('user-7')
    expect(run({}).entries[0]?.fields).not.toHaveProperty('userId')
  })
})
