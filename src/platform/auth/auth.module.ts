import { Global, Module } from '@nestjs/common'
import { createRemoteJWKSet } from 'jose'
import { ENV, type Env } from '../config/index.js'
import { AuthGuard } from './auth.guard.js'
import { JWT_KEYS, TokenVerifier } from './token-verifier.js'

@Global()
@Module({
  providers: [
    // `createRemoteJWKSet` no descarga nada hasta el primer token; cachea las claves y respeta un cooldown entre reintentos.
    { provide: JWT_KEYS, inject: [ENV], useFactory: (env: Env) => createRemoteJWKSet(new URL(env.AUTHENTIK_JWKS_URI)) },
    TokenVerifier,
    AuthGuard,
  ],
  exports: [TokenVerifier, AuthGuard, JWT_KEYS],
})
export class AuthModule {}
