import { Injectable } from '@nestjs/common'
import { InjectTx, type Tx } from '../../platform/db/index.js'
import { DomainError } from '../../platform/errors/index.js'
import type { ScaleDimension } from '../../shared/enums.js'
import { LibraryErrors } from './errors.js'
import { ControlTree } from './templates/domain/control-tree.js'
import { templateLifecycle } from './templates/domain/template.lifecycle.js'

export interface TemplateNode {
  readonly id: string
  readonly parentId: string | null
  readonly position: number
  readonly reference: string | null
  readonly title: string
}

export interface TemplateForAudit {
  readonly id: string
  readonly name: string
  /** El árbol de controles: hojas (lo que se evalúa), dominio y ruta de cada una. */
  readonly tree: ControlTree<TemplateNode>
}

export interface ScaleForAudit {
  readonly id: string
  readonly name: string
  readonly dimension: ScaleDimension
  /** Ordenadas por puntaje ascendente. `value` ya es un número. */
  readonly levels: ReadonlyArray<{ readonly id: string; readonly value: number; readonly label: string }>
}

/**
 * API pública de solo lectura para otros módulos (`audits`): la única forma en que se pregunta por plantillas y escalas, sin
 * importar nada interno de `library`. Devuelve datos ya listos para usar (el árbol, los puntajes como número).
 */
@Injectable()
export class LibraryReader {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /** La plantilla si se puede elegir para una auditoría nueva (publicada: capacidad `usable`, docs/03). */
  async getUsableTemplate(id: string): Promise<TemplateForAudit> {
    const template = await this.load(id)
    if (!templateLifecycle.has(template.status, 'usable')) {
      throw new DomainError(LibraryErrors.TEMPLATE_NOT_PUBLISHED, { id })
    }
    return this.forAudit(template)
  }

  /** La plantilla en cualquier estado (para leer una auditoría que ya la usó, aunque después se archive). */
  async getTemplate(id: string): Promise<TemplateForAudit> {
    return this.forAudit(await this.load(id))
  }

  /** La escala si se puede elegir para una auditoría nueva (activa: docs/03 §3). */
  async getActiveScale(id: string): Promise<ScaleForAudit> {
    const scale = await this.loadScale(id)
    if (!scale.isActive) throw new DomainError(LibraryErrors.SCALE_INACTIVE, { id })
    return this.scaleForAudit(scale)
  }

  /** La escala esté activa o no (para leer una auditoría que ya la usó). */
  async getScale(id: string): Promise<ScaleForAudit> {
    return this.scaleForAudit(await this.loadScale(id))
  }

  private async load(id: string) {
    const template = await this.tx.template.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    })
    if (!template) throw new DomainError(LibraryErrors.TEMPLATE_NOT_FOUND, { id })
    return template
  }

  private async forAudit(template: { id: string; name: string }): Promise<TemplateForAudit> {
    const controls = await this.tx.control.findMany({
      where: { templateId: template.id },
      select: { id: true, parentId: true, position: true, reference: true, title: true },
    })
    return { id: template.id, name: template.name, tree: new ControlTree(controls) }
  }

  private async loadScale(id: string) {
    const scale = await this.tx.scale.findUnique({ where: { id }, include: { levels: { orderBy: { value: 'asc' } } } })
    if (!scale) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id })
    return scale
  }

  private scaleForAudit(scale: {
    id: string
    name: string
    dimension: ScaleDimension
    levels: ReadonlyArray<{ id: string; value: { toNumber(): number }; label: string }>
  }): ScaleForAudit {
    return {
      id: scale.id,
      name: scale.name,
      dimension: scale.dimension,
      levels: scale.levels.map((level) => ({ id: level.id, value: level.value.toNumber(), label: level.label })),
    }
  }
}
