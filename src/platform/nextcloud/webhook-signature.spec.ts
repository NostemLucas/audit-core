import { describe, expect, it } from 'vitest'
import { signWebhook, verifyWebhookSignature } from './webhook-signature.js'

describe('webhook signature', () => {
  const secret = 'un-secreto-cualquiera'
  const body = JSON.stringify({ path: '/x', fileId: '1' })

  it('es exactamente HMAC-SHA256 (valor de referencia, calculado fuera del código): no basta con que firmar y verificar se correspondan entre sí', () => {
    // Calculado con `crypto.createHmac('sha256', secret).update(body).digest('hex')` fuera de este archivo.
    expect(signWebhook(secret, body)).toBe('f36e78a0e07620f0c2a9225b29afa9b2d833b1f02b9935f841d11d0703eba662')
  })

  it('la firma correcta, con el esquema `sha256=`, verifica', () => {
    const header = `sha256=${signWebhook(secret, body)}`
    expect(verifyWebhookSignature(secret, body, header)).toBe(true)
  })

  it('un carácter distinto en el cuerpo cambia la firma', () => {
    const header = `sha256=${signWebhook(secret, body)}`
    expect(verifyWebhookSignature(secret, body + ' ', header)).toBe(false)
  })

  it('el secreto equivocado no verifica', () => {
    const header = `sha256=${signWebhook(secret, body)}`
    expect(verifyWebhookSignature('otro-secreto', body, header)).toBe(false)
  })

  it('sin encabezado, vacío, sin el esquema `sha256=`, o con hex inválido: no verifica (nunca lanza)', () => {
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false)
    expect(verifyWebhookSignature(secret, body, '')).toBe(false)
    expect(verifyWebhookSignature(secret, body, signWebhook(secret, body))).toBe(false) // sin el prefijo
    expect(verifyWebhookSignature(secret, body, 'sha256=no-es-hex')).toBe(false)
  })

  it('una firma de otra longitud no verifica (sin comparar más allá, pero sin lanzar)', () => {
    expect(verifyWebhookSignature(secret, body, 'sha256=ab')).toBe(false)
  })
})
