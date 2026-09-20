import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { WITH_LEVELS } from '../scale.queries.js'

@Injectable()
export class GetScaleUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(id: string) {
    const scale = await this.db.scale.findUnique({ where: { id }, include: WITH_LEVELS })
    if (!scale) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id })
    return scale
  }
}
