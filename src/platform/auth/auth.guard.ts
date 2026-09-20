import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { ClsService } from 'nestjs-cls'
import '../context/cls-store.js'
import { readRouteAccess } from '../authz/route-access.js'
import { DomainError, PlatformErrors } from '../errors/index.js'
import { TokenVerifier } from './token-verifier.js'
import { USER_RESOLVER, type UserResolver } from './user-resolver.port.js'

const BEARER = /^Bearer\s+(\S+)$/i

/**
 * Autentica cada petición: verifica el Bearer, obtiene el usuario local y lo deja en `request.user` y en el contexto
 * ambiental (`userId`, que usan los sellos, el logger y los eventos). Las rutas `@Public()` se saltan este guard.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    @Inject(USER_RESOLVER) private readonly users: UserResolver,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (readRouteAccess(this.reflector, context)?.kind === 'public') return true

    const request = context.switchToHttp().getRequest<Request>()
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1]
    if (!token) throw new DomainError(PlatformErrors.TOKEN_INVALID)

    const user = await this.users.resolve(await this.verifier.verify(token))
    request.user = user
    if (this.cls.isActive()) this.cls.set('userId', user.id)
    return true
  }
}
