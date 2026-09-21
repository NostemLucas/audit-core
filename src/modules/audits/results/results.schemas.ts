import { z } from 'zod'
import { EvaluationView } from '../evaluation/evaluation.schemas.js'

const Tally = {
  total: z.int(),
  /** Marcados "no aplica": quedan fuera de todo lo demás. */
  notApplicable: z.int(),
  /** Aplicables sin nivel alcanzado todavía. */
  pending: z.int(),
  evaluated: z.int(),
  /** Evaluados con alcanzado ≥ esperado. */
  meets: z.int(),
  /** Evaluados con alcanzado < esperado. */
  below: z.int(),
  /** De ellos, cuántos vienen trasladados de la auditoría anterior sin volver a evaluarse (seguimiento). */
  carriedOver: z.int(),
}

/** Cuántos criterios quedaron en cada opción de la escala (todas las opciones, también las que nadie eligió). */
const Distribution = z.array(z.object({ levelId: z.uuid(), label: z.string(), value: z.number(), count: z.int() }))

/**
 * Cómo va la auditoría. NO hay nota global (docs/05 §6): el total lleva conteos y distribución; cada dominio, además, sus dos
 * promedios en niveles (esperado y alcanzado de los MISMOS criterios evaluados) y su brecha. Todo derivado, nada guardado.
 */
export const AuditResultsView = z.object({
  progress: z.object({
    total: z.int(),
    notStarted: z.int(),
    inProgress: z.int(),
    completed: z.int(),
    returned: z.int(),
    approved: z.int(),
  }),
  overall: z.object({ ...Tally, distribution: Distribution }),
  domains: z.array(
    z.object({
      domain: z.object({ id: z.uuid(), title: z.string() }),
      ...Tally,
      averageExpected: z.number().nullable(),
      averageAchieved: z.number().nullable(),
      /** `averageAchieved − averageExpected`; negativo = por debajo de lo esperado. */
      gap: z.number().nullable(),
      distribution: Distribution,
    }),
  ),
})

/** Un criterio por debajo de lo esperado: el criterio completo más su brecha (negativa). */
export const GapView = EvaluationView.extend({ gap: z.number() })
