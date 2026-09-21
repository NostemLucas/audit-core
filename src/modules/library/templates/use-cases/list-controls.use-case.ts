import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { controlViews } from '../template.queries.js'

@Injectable()
export class ListControlsUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** La plantilla completa como lista plana en orden de lectura; el cliente arma el árbol con `parentId` si lo necesita. */
  async execute(templateId: string) {
    const template = await this.db.template.findUnique({ where: { id: templateId }, select: { id: true } })
    if (!template) throw new DomainError(LibraryErrors.TEMPLATE_NOT_FOUND, { id: templateId })
    return controlViews(await this.db.control.findMany({ where: { templateId } }))
  }
}
