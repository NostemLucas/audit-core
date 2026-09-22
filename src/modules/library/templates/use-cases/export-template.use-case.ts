import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree, type ControlNode } from '../domain/control-tree.js'
import { type ExportedControlNode, writeTemplateYaml } from '../infrastructure/template-yaml.js'

interface ExportableControl extends ControlNode {
  readonly reference: string | null
  readonly title: string
  readonly description: string | null
}

@Injectable()
export class ExportTemplateUseCase {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** La plantilla (en cualquier estado) como YAML, en el formato que acepta la importación. */
  async execute(id: string): Promise<{ buffer: Buffer; name: string }> {
    const template = await this.db.template.findUnique({ where: { id }, select: { name: true } })
    if (!template) throw new DomainError(LibraryErrors.TEMPLATE_NOT_FOUND, { id })

    const controls = await this.db.control.findMany({ where: { templateId: id } })
    const tree = new ControlTree<ExportableControl>(controls)
    const toNode = (control: ExportableControl): ExportedControlNode => ({
      reference: control.reference,
      title: control.title,
      description: control.description,
      controls: tree.childrenOf(control.id).map(toNode),
    })
    const buffer = writeTemplateYaml({ name: template.name, controls: tree.roots().map(toNode) })
    return { buffer, name: template.name }
  }
}
