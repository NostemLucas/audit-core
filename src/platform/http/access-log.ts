import type { Request, RequestHandler } from 'express'
import type { Log } from '../logging/index.js'

const DEFAULT_IGNORED_PATHS: readonly string[] = ['/health/live', '/health/ready']

/**
 * Log de acceso: UNA línea por petición HTTP, al terminar. Es un asunto de HTTP y vive aquí; usa el logger de la
 * aplicación pero el logger no sabe de esto.
 *
 * Es un middleware (no un interceptor) a propósito: un interceptor no ve lo que ocurre antes del handler ni si el
 * handler falla, así que se perdería un 404, un rechazo de guard o un error de validación. Con el evento `close` de la
 * respuesta se registra TODO, incluidas las conexiones cortadas por el cliente.
 *
 * Qué NO se registra: cabeceras, cuerpo ni query string (pueden llevar tokens o datos personales). El nivel sale del
 * estado: 2xx/3xx `info`, 4xx `warn`, 5xx `error`.
 */
export function accessLog(log: Log, options: { ignorePaths?: readonly string[] } = {}): RequestHandler {
  const ignored = new Set(options.ignorePaths ?? DEFAULT_IGNORED_PATHS)

  return (req, res, next) => {
    const startedAt = process.hrtime.bigint()

    res.once('close', () => {
      const path = req.originalUrl.split('?')[0] ?? req.originalUrl
      if (ignored.has(path)) return

      const status = res.statusCode
      const length = Number(res.getHeader('content-length'))
      const userId = (req as Request & { user?: { id?: unknown } }).user?.id
      const route = req.route?.path as unknown

      log.at(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'Petición HTTP', {
        method: req.method,
        path,
        // El patrón de la ruta agrupa `/audits/42` y `/audits/7` en `/audits/:id`. El comodín de "no encontrada" (`*path`) no aporta.
        ...(typeof route === 'string' && !route.startsWith('*') && { route }),
        status,
        durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10,
        ...(Number.isFinite(length) && { bytes: length }),
        ...(!res.writableFinished && { aborted: true }),
        correlationId: res.locals['requestId'],
        ...(typeof userId === 'string' && { userId }),
      })
    })

    next()
  }
}
