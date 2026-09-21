import ExcelJS from 'exceljs'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import type { ImportMode, RawRow } from '../domain/control-import.js'

/**
 * Lee un libro de Excel y lo deja como filas de texto para `domain/control-import.ts`. Es lo único que conoce Excel.
 * No decide nada de negocio: reconoce columnas por su nombre (con los alias de los archivos del proyecto anterior),
 * normaliza las celdas a texto y avisa de lo que ignora.
 */
export interface WorkbookContent {
  /** El nombre de la hoja "Plantilla" (Campo / Valor), si la trae: permite subir un archivo autocontenido. */
  readonly name: string | undefined
  readonly mode: ImportMode
  readonly rows: RawRow[]
  readonly warnings: string[]
}

const COLUMNS = {
  level: ['nivel', 'level'],
  reference: ['referencia', 'reference', 'código', 'codigo', 'code'],
  title: ['título', 'titulo', 'title'],
  description: ['descripción', 'descripcion', 'description'],
  parentReference: ['código padre', 'codigo padre', 'parent code', 'parentcode', 'referencia padre'],
  /** Ya no forma parte de la plantilla (docs/04 §4.4): se ignora con un aviso. */
  guidance: ['guía auditor', 'guia auditor', 'auditor guidance', 'guidance'],
} as const
type Field = keyof typeof COLUMNS

const CONTROL_SHEETS = ['controles', 'controls', 'standards'] // "standards" es el nombre que exportaba el proyecto anterior
const TEMPLATE_SHEETS = ['plantilla', 'template']
const NAME_FIELDS = ['nombre', 'name']

const invalid = (message: string): DomainError =>
  new DomainError(LibraryErrors.TEMPLATE_IMPORT_INVALID, { errors: [{ row: 0, message }], totalErrors: 1 })

export async function readTemplateWorkbook(buffer: Buffer): Promise<WorkbookContent> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  } catch (cause) {
    throw new DomainError(
      LibraryErrors.TEMPLATE_IMPORT_INVALID,
      { errors: [{ row: 0, message: 'El archivo no es un Excel (.xlsx) válido' }], totalErrors: 1 },
      { cause },
    )
  }

  const sheet = findSheet(workbook, CONTROL_SHEETS) ?? workbook.worksheets[0]
  if (!sheet) throw invalid('El archivo no tiene ninguna hoja')

  const columns = new Map<Field, number>()
  sheet.getRow(1).eachCell((cell, column) => {
    const header = valueToText(cell.value)?.toLowerCase()
    if (!header) return
    for (const field of Object.keys(COLUMNS) as Field[]) {
      if (!columns.has(field) && (COLUMNS[field] as readonly string[]).includes(header)) columns.set(field, column)
    }
  })
  if (!columns.has('title')) throw invalid('Falta la columna "Título"')
  const mode: ImportMode | undefined = columns.has('level')
    ? 'level'
    : columns.has('parentReference')
      ? 'parent-reference'
      : undefined
  if (!mode) throw invalid('Falta la columna "Nivel" (o "Código padre" en los archivos del formato anterior)')

  const warnings: string[] = []
  if (columns.has('guidance')) {
    warnings.push('La columna de guía del auditor se ignoró: la guía ya no forma parte de la plantilla')
  }
  if (mode === 'parent-reference') {
    warnings.push(
      'El archivo usa "Código padre" (formato anterior): se resolvió dentro del archivo; el formato actual usa la columna "Nivel"',
    )
  }

  const rows: RawRow[] = []
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return
    const read = (field: Field): string | undefined => {
      const column = columns.get(field)
      return column === undefined ? undefined : valueToText(excelRow.getCell(column).value)
    }
    const row: RawRow = {
      row: rowNumber,
      level: read('level'),
      reference: read('reference'),
      title: read('title'),
      description: read('description'),
      parentReference: read('parentReference'),
    }
    const isBlank = !row.level && !row.reference && !row.title && !row.description && !row.parentReference
    if (!isBlank) rows.push(row)
  })

  return { name: readName(workbook), mode, rows, warnings }
}

function findSheet(workbook: ExcelJS.Workbook, names: readonly string[]): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) => names.includes(sheet.name.trim().toLowerCase()))
}

function readName(workbook: ExcelJS.Workbook): string | undefined {
  const sheet = findSheet(workbook, TEMPLATE_SHEETS)
  let name: string | undefined
  sheet?.eachRow({ includeEmpty: false }, (row) => {
    const field = valueToText(row.getCell(1).value)?.toLowerCase()
    const value = valueToText(row.getCell(2).value)
    if (field && NAME_FIELDS.includes(field) && value) name = value
  })
  return name
}

/**
 * Una celda como texto recortado, o `undefined` si está vacía. Se usa `.value` y no `.text`: `.text` devuelve "0" en
 * celdas vacías con formato numérico y una fila en blanco pasaría por fila con datos.
 */
export function valueToText(value: ExcelJS.CellValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  let text: string
  if (typeof value === 'string') text = value
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
  else if (value instanceof Date) text = value.toISOString()
  else if ('result' in value)
    text =
      value.result === undefined || value.result === null ? '' : (valueToText(value.result as ExcelJS.CellValue) ?? '')
  else if ('richText' in value) text = value.richText.map((part) => part.text).join('')
  else if ('text' in value) text = String(value.text)
  else if ('error' in value) text = ''
  else text = ''
  const trimmed = text.trim()
  return trimmed === '' ? undefined : trimmed
}
