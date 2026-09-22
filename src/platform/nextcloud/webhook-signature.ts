import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Firma HMAC-SHA256 de un webhook (docs/07 §1.2): sobre el CUERPO CRUDO (antes de parsear JSON — un espacio distinto
 * cambia la firma), comparada en tiempo constante para no filtrar por temporización cuánto coincide.
 */
export function signWebhook(secret: string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

/** El encabezado válido es `sha256=<hex>`; cualquier otra cosa (ausente, otro esquema, longitud distinta) no coincide. */
export function verifyWebhookSignature(secret: string, rawBody: string | Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from(signWebhook(secret, rawBody), 'hex')
  const given = Buffer.from(header.slice('sha256='.length), 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}
