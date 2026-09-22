import { Injectable } from '@nestjs/common'
import { writeMatrixYaml } from '../infrastructure/matrix-yaml.js'
import { GetSuggestedFindingsMatrixUseCase } from './get-suggested-findings-matrix.use-case.js'

@Injectable()
export class ExportSuggestedFindingsUseCase {
  constructor(private readonly matrix: GetSuggestedFindingsMatrixUseCase) {}

  /** La matriz de la plantilla para una escala, lista para completar y volver a subir. */
  async execute(templateId: string, scaleId: string): Promise<{ buffer: Buffer; name: string }> {
    const { template, scale, controls } = await this.matrix.execute(templateId, scaleId)
    const buffer = writeMatrixYaml({
      levels: scale.levels.map((level) => ({ id: level.id, value: level.value.toNumber(), label: level.label })),
      controls: controls.map((control) => ({
        id: control.id,
        domain: control.domain,
        reference: control.reference,
        title: control.title,
        texts: new Map(control.texts.map((entry) => [entry.levelId, entry.text])),
      })),
    })
    return { buffer, name: `${template.name} - ${scale.name}` }
  }
}
