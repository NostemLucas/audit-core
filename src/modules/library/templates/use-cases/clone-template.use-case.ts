import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import type { CloneTemplateT } from '../template.schemas.js'
import { loadControls, loadTemplate, lockTemplate, withActions } from '../template.queries.js'

@Injectable()
export class CloneTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Copia el árbol completo (orden incluido) y los hallazgos sugeridos de la plantilla `sourceId`, en cualquier estado, a
   * una plantilla NUEVA en borrador. El origen no cambia (no se archiva): una publicada sigue en uso por auditorías en
   * curso, y corregirla es justamente clonar y publicar la nueva. Todo o nada. Toma el bloqueo del origen para copiar un
   * estado coherente (sin una edición a medias).
   */
  @Transactional()
  async execute(sourceId: string, input: CloneTemplateT) {
    await lockTemplate(this.tx, sourceId)
    await loadTemplate(this.tx, sourceId)
    const controls = await loadControls(this.tx, sourceId)
    const findings = await this.tx.suggestedFinding.findMany({ where: { control: { templateId: sourceId } } })

    const created = await this.tx.template.create({ data: { name: input.name } })
    // Ids nuevos antes de insertar: el árbol entero va en una sentencia (la FK se comprueba al final de la sentencia).
    const ids = new Map(controls.map((control) => [control.id, randomUUID()] as const))
    await this.tx.control.createMany({
      data: controls.map((control) => ({
        id: ids.get(control.id)!,
        templateId: created.id,
        parentId: control.parentId === null ? null : ids.get(control.parentId)!,
        reference: control.reference,
        title: control.title,
        description: control.description,
        position: control.position,
      })),
    })
    await this.tx.suggestedFinding.createMany({
      data: findings.map((finding) => ({
        controlId: ids.get(finding.controlId)!,
        levelId: finding.levelId,
        text: finding.text,
      })),
    })
    return withActions(await loadTemplate(this.tx, created.id))
  }
}
