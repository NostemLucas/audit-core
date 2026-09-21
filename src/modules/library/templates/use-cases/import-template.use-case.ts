import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { buildImportPlan, type ImportIssue, type ImportNode } from '../domain/control-import.js'
import { readTemplateWorkbook } from '../infrastructure/excel-reader.js'
import { CreateTemplate } from '../template.schemas.js'
import { loadTemplate, withActions } from '../template.queries.js'

/** Cuántos errores se devuelven al cliente (el total se informa aparte). */
const MAX_ISSUES_REPORTED = 20

@Injectable()
export class ImportTemplateUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Crea una plantilla NUEVA en borrador desde un Excel. Leer y validar el archivo no necesita la transacción: solo el
   * guardado la abre. Si algo falla, no se crea nada (ni la plantilla ni un control).
   */
  async execute(input: { name: string | undefined; file: Buffer | undefined }) {
    if (!input.file || input.file.length === 0)
      throw importError([{ row: 0, message: 'Falta el archivo (campo "file")' }])

    const content = await readTemplateWorkbook(input.file)
    const named = CreateTemplate.safeParse({ name: input.name ?? content.name })
    if (!named.success) {
      throw importError([
        { row: 0, message: 'Falta el nombre de la plantilla (campo "name" o hoja "Plantilla" del archivo)' },
      ])
    }
    const plan = buildImportPlan(content.rows, content.mode)
    if (!plan.ok) throw importError(plan.issues)

    const template = await this.persist(named.data.name, plan.nodes)
    return { template, warnings: content.warnings }
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

function importError(issues: readonly ImportIssue[]): DomainError {
  return new DomainError(LibraryErrors.TEMPLATE_IMPORT_INVALID, {
    errors: issues.slice(0, MAX_ISSUES_REPORTED),
    totalErrors: issues.length,
  })
}
