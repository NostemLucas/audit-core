import { z } from 'zod'
import { DecimalNumber } from '../../../platform/http/index.js'
import { LIMITS } from '../../../shared/limits.js'

/**
 * La matriz de una plantilla PARA UNA ESCALA: una fila por control evaluable (hoja), en orden de lectura, con el texto
 * sugerido de cada opción que lo tenga. Los huecos no existen: solo se guarda (y se devuelve) lo que alguien redactó.
 */
export const SuggestedFindingsMatrixView = z.object({
  scale: z.object({
    id: z.uuid(),
    name: z.string(),
    /** Ordenadas por puntaje ascendente. */
    levels: z.array(z.object({ id: z.uuid(), value: DecimalNumber, label: z.string() })),
  }),
  controls: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string().nullable(),
      title: z.string(),
      /** El dominio (primer nivel) al que pertenece la hoja: da contexto sin que el cliente recorra el árbol. */
      domain: z.string(),
      texts: z.array(z.object({ levelId: z.uuid(), text: z.string() })),
    }),
  ),
})

export const MatrixQuery = z.object({ scaleId: z.uuid() })
export type MatrixQueryT = z.infer<typeof MatrixQuery>

export const SuggestedFindingView = z.object({ controlId: z.uuid(), levelId: z.uuid(), text: z.string() })

/** Texto plano. Vacío no es un texto: para quitar una sugerencia se usa DELETE. */
export const SetSuggestedFinding = z.object({ text: z.string().trim().min(1).max(LIMITS.text) })
export type SetSuggestedFindingT = z.infer<typeof SetSuggestedFinding>

export const LevelId = z.uuid()
