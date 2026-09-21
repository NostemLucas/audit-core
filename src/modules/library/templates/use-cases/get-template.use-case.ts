import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { WITH_CONTROL_COUNT, withActions } from '../template.queries.js'

@Injectable()
export class GetTemplateUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(id: string) {
    const template = await this.db.template.findUnique({ where: { id }, include: WITH_CONTROL_COUNT })
    if (!template) throw new DomainError(LibraryErrors.TEMPLATE_NOT_FOUND, { id })
    return withActions(template)
  }
}
