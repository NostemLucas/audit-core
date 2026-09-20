import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'
import { TokenVerifier } from '../src/platform/auth/index.js'
import { DomainError } from '../src/platform/errors/index.js'
import type { AppLogger, Log } from '../src/platform/logging/index.js'
import '../src/app-errors.js'
import { TEST_CLIENT_ID, TEST_ISSUER, testEnv } from './support/env.js'

/**
 * El verificador contra el JWKS REMOTO de verdad (`createRemoteJWKSet`), con los errores REALES de `jose` cuando la
 * descarga falla. Es lo que las demás pruebas no cubren (usan un resolutor local): si la clasificación 401 / 502 no
 * coincidiera con lo que `jose` lanza, un Authentik caído desloguearía a todos los usuarios.
 */
const noopLog: Log = { fatal() {}, error() {}, warn() {}, info() {}, debug() {}, trace() {}, at() {} }
const logger = { for: () => noopLog } as unknown as AppLogger

let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks/`
}

async function keyPair(kid = 'k1') {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  const sign = () =>
    new SignJWT({ email: 'a@x.com', preferred_username: 'a' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_CLIENT_ID)
      .setSubject('sub-1')
      .setExpirationTime('5m')
      .sign(privateKey)
  return { jwk, sign }
}

const verifierFor = (url: string) =>
  new TokenVerifier(testEnv(), createRemoteJWKSet(new URL(url), { cooldownDuration: 0, timeoutDuration: 1_500 }), logger)

async function outcome(verifier: TokenVerifier, token: string) {
  try {
    await verifier.verify(token)
    return 'ok'
  } catch (error) {
    return error instanceof DomainError ? `${error.def.http} ${error.code}` : `sin clasificar: ${String(error)}`
  }
}

describe('TokenVerifier con el JWKS remoto real', () => {
  it('descarga el JWKS por HTTP y elige la clave por kid', async () => {
    const { jwk, sign } = await keyPair('k1')
    const url = await serve((_req, res) => void res.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [jwk] })))
    expect(await outcome(verifierFor(url), await sign())).toBe('ok')
  })

  it('elige la clave correcta entre varias (rotación de claves)', async () => {
    const old = await keyPair('vieja')
    const current = await keyPair('nueva')
    const url = await serve((_req, res) => void res.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [old.jwk, current.jwk] })))
    const verifier = verifierFor(url)
    expect(await outcome(verifier, await old.sign())).toBe('ok')
    expect(await outcome(verifier, await current.sign())).toBe('ok')
  })

  it('un kid que NO está en el JWKS es un token inválido: 401', async () => {
    const other = await keyPair('desconocida')
    const listed = await keyPair('listada')
    const url = await serve((_req, res) => void res.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [listed.jwk] })))
    expect(await outcome(verifierFor(url), await other.sign())).toBe('401 TOKEN_INVALID')
  })

  it('JWKS inalcanzable (conexión rechazada) → 502, NO 401', async () => {
    const { sign } = await keyPair()
    expect(await outcome(verifierFor('http://127.0.0.1:1/jwks/'), await sign())).toBe('502 UPSTREAM_UNAVAILABLE')
  })

  it('el servidor del JWKS responde 500 → 502', async () => {
    const { sign } = await keyPair()
    const url = await serve((_req, res) => void ((res.statusCode = 500), res.end('error')))
    expect(await outcome(verifierFor(url), await sign())).toBe('502 UPSTREAM_UNAVAILABLE')
  })

  it('el servidor del JWKS responde 404 (URL mal configurada) → 502', async () => {
    const { sign } = await keyPair()
    const url = await serve((_req, res) => void ((res.statusCode = 404), res.end()))
    expect(await outcome(verifierFor(url), await sign())).toBe('502 UPSTREAM_UNAVAILABLE')
  })

  it('el JWKS no es JSON válido → 502', async () => {
    const { sign } = await keyPair()
    const url = await serve((_req, res) => void res.end('<html>no soy un JWKS</html>'))
    expect(await outcome(verifierFor(url), await sign())).toBe('502 UPSTREAM_UNAVAILABLE')
  })

  it('el servidor del JWKS no responde a tiempo (timeout) → 502', async () => {
    const { sign } = await keyPair()
    const url = await serve(() => undefined) // nunca contesta
    expect(await outcome(verifierFor(url), await sign())).toBe('502 UPSTREAM_UNAVAILABLE')
  }, 10_000)

  it('ningún fallo del JWKS queda sin clasificar (nunca llega un error crudo al filtro)', async () => {
    const { sign } = await keyPair()
    for (const url of ['http://127.0.0.1:1/jwks/', await serve((_req, res) => void res.end('basura'))]) {
      expect(await outcome(verifierFor(url), await sign())).not.toMatch(/^sin clasificar/)
    }
  })

  it('con el JWKS ya en caché, una clave conocida sigue valiendo aunque Authentik caiga', async () => {
    const { jwk, sign } = await keyPair('k1')
    const url = await serve((_req, res) => void res.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [jwk] })))
    const verifier = new TokenVerifier(testEnv(), createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000 }), logger)
    expect(await outcome(verifier, await sign())).toBe('ok')
    await new Promise<void>((resolve) => server!.close(() => resolve())) // Authentik cae
    server = undefined
    expect(await outcome(verifier, await sign())).toBe('ok')
  })
})
