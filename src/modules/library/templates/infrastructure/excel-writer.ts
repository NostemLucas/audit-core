import ExcelJS from 'exceljs'

/**
 * Escribe una plantilla como libro de Excel en el mismo formato que lee `excel-reader.ts` (la ida y vuelta es estable):
 * hoja "Controles" con Nivel / Referencia / Título / Descripción en orden de lectura, y hoja "Plantilla" con el nombre.
 */
export interface ExportedControl {
  /** 1 = dominio (primer nivel). */
  readonly level: number
  readonly reference: string | null
  readonly title: string
  readonly description: string | null
}

export async function writeTemplateWorkbook(input: {
  name: string
  controls: readonly ExportedControl[]
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  const controls = workbook.addWorksheet('Controles', { views: [{ state: 'frozen', ySplit: 1 }] })
  controls.columns = [
    { header: 'Nivel', key: 'level', width: 8 },
    { header: 'Referencia', key: 'reference', width: 16 },
    { header: 'Título', key: 'title', width: 80 },
    { header: 'Descripción', key: 'description', width: 60 },
  ]
  for (const control of input.controls) {
    controls.addRow({
      level: control.level,
      reference: control.reference ?? '',
      title: control.title,
      description: control.description ?? '',
    })
  }
  controls.getRow(1).font = { bold: true }
  controls.getColumn('title').alignment = { wrapText: true, vertical: 'top' }
  controls.getColumn('description').alignment = { wrapText: true, vertical: 'top' }

  const template = workbook.addWorksheet('Plantilla')
  template.columns = [
    { header: 'Campo', key: 'field', width: 20 },
    { header: 'Valor', key: 'value', width: 60 },
  ]
  template.addRow({ field: 'Nombre', value: input.name })
  template.getRow(1).font = { bold: true }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
