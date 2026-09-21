import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'

@Injectable()
export class DeleteScaleUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Con auditorías, la FK (Restrict) lo impide y sale como SCALE_IN_USE: se desactiva en su lugar. Sus opciones caen en
   * cascada, salvo que tengan hallazgos sugeridos (texto redactado que no se destruye en silencio): se comprueba antes
   * para responder lo mismo con el motivo.
   */
  @Transactional()
  async execute(id: string): Promise<void> {
    const findings = await this.tx.suggestedFinding.count({ where: { level: { scaleId: id } } })
    if (findings > 0) throw new DomainError(LibraryErrors.SCALE_IN_USE, { id, reason: 'SUGGESTED_FINDINGS', findings })
    const { count } = await this.tx.scale.deleteMany({ where: { id } })
    if (count === 0) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id })
  }
}
