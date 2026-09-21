import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'

@Injectable()
export class GetSuggestedFindingsMatrixUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  async execute(templateId: string, scaleId: string) {
    const template = await this.db.template.findUnique({ where: { id: templateId }, select: { id: true, name: true } })
    if (!template) throw new DomainError(LibraryErrors.TEMPLATE_NOT_FOUND, { id: templateId })
    const scale = await this.db.scale.findUnique({
      where: { id: scaleId },
      include: { levels: { orderBy: { value: 'asc' } } },
    })
    if (!scale) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id: scaleId })

    const [controls, findings] = await Promise.all([
      this.db.control.findMany({ where: { templateId } }),
      this.db.suggestedFinding.findMany({
        where: { control: { templateId }, levelId: { in: scale.levels.map((level) => level.id) } },
      }),
    ])
    const textsByControl = new Map<string, Array<{ levelId: string; text: string }>>()
    for (const { controlId, levelId, text } of findings) {
      textsByControl.set(controlId, [...(textsByControl.get(controlId) ?? []), { levelId, text }])
    }
    const tree = new ControlTree(controls)

    return {
      template,
      scale: { id: scale.id, name: scale.name, levels: scale.levels },
      // Solo las hojas: un control que hoy es agrupador puede conservar textos de cuando era hoja, pero no se muestran.
      controls: tree.leaves().map((leaf) => ({
        id: leaf.id,
        reference: leaf.reference,
        title: leaf.title,
        domain: tree.rootOf(leaf.id).title,
        texts: textsByControl.get(leaf.id) ?? [],
      })),
    }
  }
}
