import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import { type HeaderCell, levelHeader, type LevelRef, type MatrixRow } from '../domain/suggested-findings-import.js'

/**
 * Lee y escribe el YAML de la matriz de hallazgos sugeridos: lo único que conoce el formato de este archivo. Una
 * entrada por control (hoja), con un texto por opción de la escala bajo `texts` (la clave es la misma cabecera que
 * escribe la exportación: "50 – Parcial"). El campo `id` identifica al control al volver a subir el archivo; `domain`,
 * `reference` y `control` son solo de contexto para quien lo edita y se ignoran al importar.
 */
export interface MatrixWorkbookInput {
  readonly levels: readonly LevelRef[]
  readonly controls: ReadonlyArray<{
    readonly id: string
    readonly domain: string
    readonly reference: string | null
    readonly title: string
    readonly texts: ReadonlyMap<string, string>
  }>
}

export function writeMatrixYaml(input: MatrixWorkbookInput): Buffer {
  // Todas las opciones, aunque estén vacías (como las columnas de Excel): el archivo muestra qué claves rellenar
  // incluso la primera vez, sin sugerencias todavía.
  const findings = input.controls.map((control) => ({
    id: control.id,
    domain: control.domain,
    reference: control.reference,
    control: control.title,
    texts: Object.fromEntries(input.levels.map((level) => [levelHeader(level), control.texts.get(level.id) ?? ''])),
  }))
  return Buffer.from(stringifyYaml({ findings }), 'utf8')
}

export interface MatrixContent {
  readonly headers: readonly HeaderCell[]
  readonly rows: readonly MatrixRow[]
}

const YamlFindingEntry = z.object({
  id: z.string().trim().min(1).nullable().optional(),
  domain: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  control: z.string().nullable().optional(),
  texts: z.record(z.string(), z.string().nullable()).nullable().optional(),
})
const YamlMatrix = z.object({ findings: z.array(YamlFindingEntry).optional() })

const invalid = (message: string, cause?: unknown): DomainError =>
  new DomainError(
    LibraryErrors.TEMPLATE_IMPORT_INVALID,
    { errors: [{ row: 0, message }], totalErrors: 1 },
    cause === undefined ? undefined : { cause },
  )

export function readMatrixYaml(buffer: Buffer): MatrixContent {
  let raw: unknown
  try {
    raw = parseYaml(buffer.toString('utf8'))
  } catch (cause) {
    throw invalid('El archivo no es un YAML válido', cause)
  }
  const parsed = YamlMatrix.safeParse(raw ?? {})
  if (!parsed.success) throw invalid('El archivo no tiene el formato esperado (¿falta "findings"?)')
  const entries = parsed.data.findings ?? []

  // Cada clave de texto vista en cualquier entrada, en orden de primera aparición: es la "columna" (docs/01 §4).
  const headers: HeaderCell[] = []
  const columnOf = new Map<string, number>()
  for (const entry of entries) {
    for (const key of Object.keys(entry.texts ?? {})) {
      if (columnOf.has(key)) continue
      const column = headers.length + 1
      columnOf.set(key, column)
      headers.push({ column, header: key })
    }
  }

  const rows: MatrixRow[] = entries.map((entry, index) => ({
    row: index + 1,
    controlId: entry.id?.toLowerCase() ?? undefined,
    cells: Object.entries(entry.texts ?? {}).flatMap(([key, text]) => {
      const trimmed = text?.trim()
      return trimmed ? [{ column: columnOf.get(key)!, text: trimmed }] : []
    }),
  }))
  return { headers, rows }
}
