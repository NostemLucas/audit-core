import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { DomainError } from '../../../../platform/errors/index.js'
import { LibraryErrors } from '../../errors.js'
import type { ImportControlNode } from '../domain/control-import.js'

/**
 * Lee y escribe el YAML de una plantilla. Es lo único que conoce el formato del archivo: la anidación de `controls` ES
 * la jerarquía (no hace falta ninguna columna "nivel", a diferencia del formato anterior en Excel). No decide nada de
 * negocio: eso es `domain/control-import.ts`.
 */
export interface TemplateYamlContent {
  readonly name: string | undefined
  readonly tree: readonly ImportControlNode[]
}

/** Texto libre, sin exigir nada (ni siquiera que no esté vacío): eso lo decide `buildImportPlan`, no el lector. */
const optionalText = z.string().nullable().optional()

const YamlControlSchema: z.ZodType<ImportControlNode> = z.lazy(() =>
  z.object({
    reference: optionalText,
    title: optionalText,
    description: optionalText,
    controls: z.array(YamlControlSchema).optional(),
  }),
)
const YamlTemplateSchema = z.object({
  name: optionalText,
  controls: z.array(YamlControlSchema).optional(),
})

const invalid = (message: string, cause?: unknown): DomainError =>
  new DomainError(
    LibraryErrors.TEMPLATE_IMPORT_INVALID,
    { errors: [{ row: 0, message }], totalErrors: 1 },
    cause === undefined ? undefined : { cause },
  )

export function readTemplateYaml(buffer: Buffer): TemplateYamlContent {
  let raw: unknown
  try {
    raw = parseYaml(buffer.toString('utf8'))
  } catch (cause) {
    throw invalid('El archivo no es un YAML válido', cause)
  }
  if (raw === null || raw === undefined) throw invalid('El archivo no tiene ningún control')
  const parsed = YamlTemplateSchema.safeParse(raw)
  if (!parsed.success) throw invalid('El archivo no tiene el formato esperado (¿falta "controls"?)')
  return { name: parsed.data.name ?? undefined, tree: parsed.data.controls ?? [] }
}

export interface ExportedControlNode {
  readonly reference: string | null
  readonly title: string
  readonly description: string | null
  readonly controls: readonly ExportedControlNode[]
}

export function writeTemplateYaml(input: { name: string; controls: readonly ExportedControlNode[] }): Buffer {
  const plain = (node: ExportedControlNode): Record<string, unknown> => ({
    reference: node.reference,
    title: node.title,
    description: node.description,
    ...(node.controls.length > 0 && { controls: node.controls.map(plain) }),
  })
  const text = stringifyYaml({ name: input.name, controls: input.controls.map(plain) })
  return Buffer.from(text, 'utf8')
}
