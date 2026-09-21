import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import type { CreateTemplateT } from '../template.schemas.js'
import { WITH_CONTROL_COUNT, withActions } from '../template.queries.js'

@Injectable()
export class CreateTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** Nace vacía y en borrador. Un nombre repetido (sin distinguir mayúsculas) lo rechaza la BD. */
  @Transactional()
  async execute(input: CreateTemplateT) {
    return withActions(await this.tx.template.create({ data: { name: input.name }, include: WITH_CONTROL_COUNT }))
  }
}
