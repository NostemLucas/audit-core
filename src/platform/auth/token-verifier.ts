import { Inject, Injectable } from '@nestjs/common'
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { ENV, type Env } from '../config/index.js'
import { DomainError, PlatformErrors } from '../errors/index.js'
import { AppLogger, type Log } from '../logging/index.js'
import type { TokenClaims } from './user-resolver.port.js'

/** Resuelve la clave pública que firmó un token. En producción, el JWKS remoto de Authentik (con caché). */
export const JWT_KEYS = Symbol('JWT_KEYS')

/** Algoritmos asimétricos permitidos. Nunca `none` ni HS*: evita el ataque de confusión de algoritmo. */
const ALGORITHMS = ['RS256', 'ES256']

/** Errores de `jose` que significan "este token no vale" (a diferencia de "no pude comprobarlo"). */
const BAD_TOKEN: ReadonlyArray<new (...args: never[]) => Error> = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
]

@Injectable()
export class TokenVerifier {
  private readonly log: Log

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(JWT_KEYS) private readonly keys: JWTVerifyGetKey,
    logger: AppLogger,
  ) {
    this.log = logger.for('TokenVerifier')
  }

  /**
   * Verifica firma, `iss`, `aud`, expiración y algoritmo. Distingue dos fallos que NO se deben mezclar:
   *  - el token es inválido → TOKEN_INVALID (401): el cliente debe autenticarse de nuevo;
   *  - no se pudo comprobar (Authentik/JWKS caído) → UPSTREAM_UNAVAILABLE (502): con 401 todos los usuarios parecerían
   *    deslogueados por un fallo que no es suyo.
   * Al cliente no se le dice por qué falló (no dar pistas); el motivo queda en el log, en debug.
   */
  async verify(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.env.AUTHENTIK_ISSUER,
        audience: this.env.AUTHENTIK_CLIENT_ID,
        algorithms: ALGORITHMS,
        requiredClaims: ['sub', 'exp'],
      })
      return payload as TokenClaims
    } catch (cause) {
      if (BAD_TOKEN.some((type) => cause instanceof type)) {
        this.log.debug('Token rechazado', { reason: (cause as { code?: string }).code ?? (cause as Error).name })
        throw new DomainError(PlatformErrors.TOKEN_INVALID, undefined, { cause })
      }
      throw new DomainError(PlatformErrors.UPSTREAM_UNAVAILABLE, { service: 'authentik' }, { cause })
    }
  }
}
