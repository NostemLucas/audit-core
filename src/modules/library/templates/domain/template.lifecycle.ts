import { defineLifecycle } from '../../../../platform/state/index.js'
import { TemplateStatus } from '../../../../shared/enums.js'
import { LibraryErrors } from '../../errors.js'

/**
 * Ciclo de vida de la plantilla (docs/03 §2.4). Única definición de sus estados, transiciones y capacidades:
 *  - `editable`: solo en borrador se cambia la estructura o el contenido (PUBLISHED es inmutable: clonar para corregir).
 *  - `usable`: solo una plantilla publicada se puede elegir para una auditoría nueva.
 */
export const TEMPLATE_EVENTS = ['PUBLISH', 'ARCHIVE'] as const
export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number]
export type TemplateTag = 'editable' | 'usable'

export const templateLifecycle = defineLifecycle<TemplateStatus, TemplateEvent, TemplateTag>({
  entity: 'TEMPLATE',
  invalidState: LibraryErrors.TEMPLATE_INVALID_STATE,
  states: {
    DRAFT: { on: { PUBLISH: 'PUBLISHED' }, tags: ['editable'] },
    PUBLISHED: { on: { ARCHIVE: 'ARCHIVED' }, tags: ['usable'] },
    ARCHIVED: { on: {}, tags: [] },
  },
})

/** Lanza TEMPLATE_NOT_EDITABLE si la plantilla no está en borrador. */
export function assertTemplateEditable(status: TemplateStatus): void {
  templateLifecycle.assert(status, 'editable', LibraryErrors.TEMPLATE_NOT_EDITABLE)
}
