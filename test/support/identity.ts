import { generateKeyPair, SignJWT, UnsecuredJWT, type JWTVerifyGetKey } from 'jose'
import { TEST_CLIENT_ID, TEST_ISSUER } from './env.js'

type Claims = Record<string, unknown>

export interface SignOptions {
  /** Sustituye o añade claims (un valor `undefined` elimina el claim). */
  claims?: Claims
  issuer?: string
  audience?: string
  /** Segundos desde ahora; negativo = ya vencido. `null` = sin `exp`. */
  expiresIn?: number | null
  /** Segundos desde ahora en que empieza a valer (`nbf`). */
  notBefore?: number
  /** Firmar con otra clave (firma que el verificador no reconoce). */
  withOtherKey?: boolean
  subject?: string | null
}

/** Un emisor de tokens de prueba: firma con una clave RSA real y expone el resolutor de claves que usa el verificador. */
export async function createTestIssuer() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const other = await generateKeyPair('RS256')

  const keys: JWTVerifyGetKey = async () => publicKey

  async function sign(options: SignOptions = {}): Promise<string> {
    const claims: Claims = {
      email: 'ana.perez@ejemplo.com',
      preferred_username: 'Ana.Perez',
      name: 'Ana Pérez',
      groups: ['auditor'],
      ...options.claims,
    }
    for (const [key, value] of Object.entries(claims)) if (value === undefined) delete claims[key]

    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? TEST_CLIENT_ID)
      .setIssuedAt()
    if (options.subject !== null) jwt.setSubject(options.subject ?? 'sub-ana')
    if (options.expiresIn !== null) jwt.setExpirationTime(Math.floor(Date.now() / 1000) + (options.expiresIn ?? 300))
    if (options.notBefore !== undefined) jwt.setNotBefore(Math.floor(Date.now() / 1000) + options.notBefore)
    return jwt.sign(options.withOtherKey ? other.privateKey : privateKey)
  }

  /** Un JWT con `alg: none` (sin firma): el ataque clásico; debe rechazarse siempre. */
  const unsigned = () =>
    new UnsecuredJWT({ email: 'x@y.com', preferred_username: 'x' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_CLIENT_ID)
      .setSubject('sub-x')
      .setExpirationTime('5m')
      .encode()

  /** Un token firmado con HS256 usando material público como secreto: el ataque de confusión de algoritmo. */
  async function algConfusion(): Promise<string> {
    const secret = new TextEncoder().encode('cualquier-secreto-conocido')
    return new SignJWT({ email: 'x@y.com', preferred_username: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_CLIENT_ID)
      .setSubject('sub-x')
      .setExpirationTime('5m')
      .sign(secret)
  }

  return { keys, sign, unsigned, algConfusion }
}
