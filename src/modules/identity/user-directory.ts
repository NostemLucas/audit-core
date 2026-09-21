import { Injectable } from '@nestjs/common'
import { InjectTx, type Tx } from '../../platform/db/index.js'
import { DomainError } from '../../platform/errors/index.js'
import type { Role } from '../../shared/enums.js'
import { IdentityErrors } from './errors.js'

export interface DirectoryUser {
  readonly id: string
  readonly name: string
  readonly username: string
  readonly email: string
  readonly roles: readonly Role[]
}

const SELECT = { id: true, name: true, username: true, email: true, roles: true } as const

/**
 * API pública de solo lectura sobre los usuarios (espejo de Authentik) para otros módulos: validar que alguien existe y qué roles
 * globales tiene, y ponerle nombre a un id. Es la única forma en que otro módulo pregunta por un usuario.
 */
@Injectable()
export class UserDirectory {
  constructor(@InjectTx() private readonly tx: Tx) {}

  async getOrFail(id: string): Promise<DirectoryUser> {
    const user = await this.tx.user.findUnique({ where: { id }, select: SELECT })
    if (!user) throw new DomainError(IdentityErrors.USER_NOT_FOUND, { id })
    return user
  }
}
