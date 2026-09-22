import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { buildImportPlan, type ImportNode } from '../domain/control-import.js'
import { importError } from '../import-error.js'
import { readTemplateYaml } from '../infrastructure/template-yaml.js'
import { CreateTemplate } from '../template.schemas.js'
import { loadTemplate, withActions } from '../template.queries.js'

@Injectable()
export class ImportTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Crea una plantilla NUEVA en borrador desde un YAML. Leer y validar el archivo no necesita la transacción: solo el
   * guardado la abre. Si algo falla, no se crea nada (ni la plantilla ni un control).
   */
  async execute(input: { name: string | undefined; file: Buffer | undefined }) {
    if (!input.file || input.file.length === 0)
      throw importError([{ row: 0, message: 'Falta el archivo (campo "file")' }])

    const content = readTemplateYaml(input.file)
    const named = CreateTemplate.safeParse({ name: input.name ?? content.name })
    if (!named.success) {
      throw importError([
        { row: 0, message: 'Falta el nombre de la plantilla (campo "name" o clave "name" del archivo)' },
      ])
    }
    const plan = buildImportPlan(content.tree)
    if (!plan.ok) throw importError(plan.issues)

    return { template: await this.persist(named.data.name, plan.nodes) }
  }

  @Transactional()
  protected async persist(name: string, nodes: readonly ImportNode[]) {
    const created = await this.tx.template.create({ data: { name } })
    // Los ids se generan aquí para insertar todo el árbol en UNA sentencia (los padres y los hijos van juntos: la FK se
    // comprueba al final de la sentencia). Solo importa que sean únicos, no su orden temporal.
    const ids = nodes.map(() => randomUUID())
    await this.tx.control.createMany({
      data: nodes.map((node) => ({
        id: ids[node.index]!,
        templateId: created.id,
        parentId: node.parentIndex === null ? null : ids[node.parentIndex]!,
        reference: node.reference,
        title: node.title,
        description: node.description,
        position: node.position,
      })),
    })
    return withActions(await loadTemplate(this.tx, created.id))
  }
}
