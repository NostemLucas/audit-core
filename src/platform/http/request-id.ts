import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

const VALID_ID = /^[\w.-]{8,128}$/

/**
 * Asigna un id a cada petición (el `x-request-id` entrante si es razonable, o uno nuevo), lo devuelve en la
 * cabecera y lo deja en `res.locals.requestId`. Es el `traceId` de los errores y lo usará el logger.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id')
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID()
  res.locals['requestId'] = id
  res.setHeader('x-request-id', id)
  next()
}
