import ExcelJS from 'exceljs'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { type HeaderCell, levelHeader, type LevelRef, type MatrixRow } from '../domain/suggested-findings-import.js'
import { valueToText } from './excel-reader.js'

/**
 * Excel de la matriz de hallazgos sugeridos: lo único que conoce el libro de esta matriz. Escribe una fila por control
 * (hoja) y una columna por opción de la escala; lee lo mismo de vuelta (la columna `ID` identifica al control).
 */
export interface MatrixWorkbookInput {
  readonly levels: readonly LevelRef[]
  readonly controls: ReadonlyArray<{
    readonly id: string
    readonly domain: string
    readonly reference: string | null
    readonly title: string
    /** Texto sugerido por id de opción. */
    readonly texts: ReadonlyMap<string, string>
  }>
}

const SHEET = 'Hallazgos'
const FIXED = 4 // ID, Dominio, Referencia, Control

export async function writeMatrixWorkbook(input: MatrixWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(SHEET, { views: [{ state: 'frozen', xSplit: FIXED, ySplit: 1 }] })
  sheet.columns = [
    // El ID va oculto (como en el formato anterior): identifica al control al volver a subir el archivo.
    { header: 'ID', key: 'id', width: 38, hidden: true },
    { header: 'Dominio', key: 'domain', width: 28 },
    { header: 'Referencia', key: 'reference', width: 14 },
    { header: 'Control', key: 'title', width: 60 },
    ...input.levels.map((level) => ({ header: levelHeader(level), key: level.id, width: 50 })),
  ]
  for (const control of input.controls) {
    sheet.addRow({
      id: control.id,
      domain: control.domain,
      reference: control.reference ?? '',
      title: control.title,
      ...Object.fromEntries(input.levels.map((level) => [level.id, control.texts.get(level.id) ?? ''])),
    })
  }
  sheet.getRow(1).font = { bold: true }
  for (let column = 2; column <= FIXED + input.levels.length; column++) {
    sheet.getColumn(column).alignment = { wrapText: true, vertical: 'top' }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export interface MatrixContent {
  readonly headers: readonly HeaderCell[]
  readonly rows: readonly MatrixRow[]
}

const invalid = (message: string, cause?: unknown): DomainError =>
  new DomainError(
    LibraryErrors.TEMPLATE_IMPORT_INVALID,
    { errors: [{ row: 0, message }], totalErrors: 1 },
    cause === undefined ? undefined : { cause },
  )

export async function readMatrixWorkbook(buffer: Buffer): Promise<MatrixContent> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  } catch (cause) {
    throw invalid('El archivo no es un Excel (.xlsx) válido', cause)
  }
  const sheet = workbook.getWorksheet(SHEET) ?? workbook.worksheets[0]
  if (!sheet) throw invalid('El archivo no tiene ninguna hoja')

  const headers: HeaderCell[] = []
  let idColumn: number | undefined
  sheet.getRow(1).eachCell((cell, column) => {
    const header = valueToText(cell.value)
    if (!header) return
    if (idColumn === undefined && ['id', 'id (sistema)'].includes(header.toLowerCase())) idColumn = column
    else headers.push({ column, header })
  })
  if (idColumn === undefined) throw invalid('Falta la columna "ID": descarga la matriz desde el sistema y complétala')

  const rows: MatrixRow[] = []
  const known = idColumn
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return
    const cells = headers.flatMap(({ column }) => {
      const text = valueToText(excelRow.getCell(column).value)
      return text === undefined ? [] : [{ column, text }]
    })
    const controlId = valueToText(excelRow.getCell(known).value)
    if (controlId !== undefined || cells.length > 0) rows.push({ row: rowNumber, controlId, cells })
  })
  return { headers, rows }
}
