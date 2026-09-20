import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'

@Injectable()
export class DeleteScaleUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Con auditorías, la FK (Restrict) lo impide y sale como SCALE_IN_USE: se desactiva en su lugar. Sus opciones caen en cascada. */
  @Transactional()
  async execute(id: string): Promise<void> {
    const { count } = await this.tx.scale.deleteMany({ where: { id } })
    if (count === 0) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id })
  }
}
