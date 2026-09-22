import { z } from 'zod'
import { CalendarDate } from '../../platform/http/index.js'
import { AuditStatus, EvaluationStatus } from '../../shared/enums.js'

/** Panorama de las auditorías que el actor puede ver (docs/08 §1). Sin nota global ni actividad entre auditorías. */
export const DashboardSummaryView = z.object({
  audits: z.object({
    total: z.int(),
    byStatus: z.object({
      DRAFT: z.int(),
      IN_PROGRESS: z.int(),
      CLOSED: z.int(),
      ARCHIVED: z.int(),
    }),
  }),
  /** Criterios enviados a revisión (`COMPLETED`) en auditorías visibles: esperan a un líder. */
  evaluations: z.object({ pendingReview: z.int() }),
  /** Auditorías EN CURSO por su `plannedEnd`: ya vencidas, o dentro de los próximos días (docs/08 §1). */
  deadlines: z.object({ overdue: z.int(), upcoming: z.int() }),
})

const MyWorkEvaluationItem = z.object({
  auditId: z.uuid(),
  auditCode: z.string(),
  auditName: z.string(),
  evaluationId: z.uuid(),
  control: z.object({ reference: z.string().nullable(), title: z.string() }),
  status: z.enum(EvaluationStatus),
  plannedEnd: CalendarDate.nullable(),
})

const MyWorkAuditItem = z.object({
  auditId: z.uuid(),
  auditCode: z.string(),
  auditName: z.string(),
  status: z.enum(AuditStatus),
  plannedEnd: CalendarDate.nullable(),
  /** Criterios que aún no están `APPROVED`. */
  pendingCount: z.int(),
})

/** Lo pendiente del actor, cruzando auditorías (docs/08 §1): un resumen (tope fijo), no un listado completo. */
export const MyWorkView = z.object({
  /** Asignados a mí, sin terminar: arrancar, seguir o corregir tras una devolución. */
  toEvaluate: z.array(MyWorkEvaluationItem),
  /** Enviados a revisión en auditorías donde soy líder. */
  toReview: z.array(MyWorkEvaluationItem),
  /** Mis auditorías como manager, en curso, con algo sin aprobar. */
  managing: z.array(MyWorkAuditItem),
})
