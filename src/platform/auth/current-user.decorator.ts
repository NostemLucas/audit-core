import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { AuthenticatedUser } from './authenticated-user.js'

/** El usuario de la petición: `get(@CurrentUser() user: AuthenticatedUser)`. En rutas `@Public()` es `undefined`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    return context.switchToHttp().getRequest<Request>().user
  },
)
