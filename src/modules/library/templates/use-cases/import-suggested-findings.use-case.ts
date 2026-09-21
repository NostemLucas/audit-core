import { Injectable } from '@nestjs/common'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { ControlTree } from '../domain/control-tree.js'
import { matchLevelColumns, planSuggestedImport } from '../domain/suggested-findings-import.js'
import { importError } from '../import-error.js'
import { type MatrixContent, readMatrixWorkbook } from '../infrastructure/matrix-excel.js'
import { loadControls, loadTemplate } from '../template.queries.js'

@Injectable()
export class ImportSuggestedFindingsUseCase {
  constructor(@InjectTx() private readonly tx: Tx) {}

  /**
   * Carga la matriz de una escala desde un Excel. Solo AGREGA o CAMBIA sugerencias: una celda vacía no borra nada (borrar es
   * explícito). Todo o nada: si el archivo tiene errores no se guarda ninguna celda. Se permite en cualquier estado de la
   * plantilla, como escribir una sugerencia suelta. Leer el archivo no necesita la transacción.
   */
  async execute(input: { templateId: string; scaleId: string; file: Buffer | undefined }) {
    if (!input.file || input.file.length === 0)
      throw importError([{ row: 0, message: 'Falta el archivo (campo "file")' }])
    return this.apply(input.templateId, input.scaleId, await readMatrixWorkbook(input.file))
  }

  /**
   * Un número FIJO de sentencias (no una por celda): las transacciones tienen un tiempo máximo y una matriz grande son miles
   * de celdas. Altas con `createMany` y cambios con un solo UPDATE sobre `unnest`.
   */
  @Transactional()
  protected async apply(templateId: string, scaleId: string, workbook: MatrixContent) {
    await loadTemplate(this.tx, templateId)
    const scale = await this.tx.scale.findUnique({ where: { id: scaleId }, include: { levels: true } })
    if (!scale) throw new DomainError(LibraryErrors.SCALE_NOT_FOUND, { id: scaleId })

    const match = matchLevelColumns(
      workbook.headers,
      scale.levels.map((level) => ({ id: level.id, value: level.value.toNumber(), label: level.label })),
    )
    if (match.issues.length > 0) throw importError(match.issues)
    const tree = new ControlTree(await loadControls(this.tx, templateId))
    const plan = planSuggestedImport(workbook.rows, match.levelByColumn, new Set(tree.leaves().map((leaf) => leaf.id)))
    if (!plan.ok) throw importError(plan.issues)

    const existing = new Map(
      (
        await this.tx.suggestedFinding.findMany({
          where: {
            controlId: { in: plan.cells.map((cell) => cell.controlId) },
            levelId: { in: scale.levels.map((l) => l.id) },
          },
        })
      ).map((finding) => [`${finding.controlId}:${finding.levelId}`, finding.text] as const),
    )
    const toCreate = plan.cells.filter((cell) => !existing.has(`${cell.controlId}:${cell.levelId}`))
    const toUpdate = plan.cells.filter((cell) => {
      const current = existing.get(`${cell.controlId}:${cell.levelId}`)
      return current !== undefined && current !== cell.text
    })

    if (toCreate.length > 0) await this.tx.suggestedFinding.createMany({ data: toCreate })
    if (toUpdate.length > 0) {
      await this.tx.$executeRaw`
        UPDATE "suggested_findings" AS sf SET "text" = v."text", "updatedAt" = now()
        FROM unnest(${toUpdate.map((c) => c.controlId)}::uuid[], ${toUpdate.map((c) => c.levelId)}::uuid[], ${toUpdate.map((c) => c.text)}::text[])
          AS v("controlId", "levelId", "text")
        WHERE sf."controlId" = v."controlId" AND sf."levelId" = v."levelId"`
    }
    return {
      created: toCreate.length,
      updated: toUpdate.length,
      unchanged: plan.cells.length - toCreate.length - toUpdate.length,
      warnings: match.ignored.map(
        (header) => `Se ignoró la columna "${header}": no corresponde a ninguna opción de la escala`,
      ),
    }
  }
}
