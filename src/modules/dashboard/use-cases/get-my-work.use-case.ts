import { Inject, Injectable } from '@nestjs/common'
import { type AuthenticatedUser } from '../../../platform/auth/index.js'
import { DB, type Db } from '../../../platform/db/index.js'
import { LIMITS } from '../../../shared/limits.js'
import { LibraryReader, type TemplateForAudit } from '../../library/index.js'

const AUDIT_SELECT = { id: true, code: true, name: true, templateId: true, plannedEnd: true } as const

interface EvaluationRow {
  id: string
  controlId: string
  status: string
  audit: { id: string; code: string; name: string; templateId: string; plannedEnd: Date | null }
}

@Injectable()
export class GetMyWorkUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryReader,
  ) {}

  /** Lo pendiente del actor, cruzando auditorías (docs/08 §1): un resumen, no un listado completo. */
  async execute(actor: AuthenticatedUser) {
    const [toEvaluateRows, toReviewRows, managingRows] = await Promise.all([
      this.db.evaluation.findMany({
        where: {
          assignedUserId: actor.id,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED'] },
          audit: { status: 'IN_PROGRESS' },
        },
        select: { id: true, controlId: true, status: true, audit: { select: AUDIT_SELECT } },
        orderBy: [{ audit: { plannedEnd: 'asc' } }, { id: 'asc' }],
        take: LIMITS.dashboardItems,
      }),
      this.db.evaluation.findMany({
        where: {
          status: 'COMPLETED',
          audit: { status: 'IN_PROGRESS', members: { some: { userId: actor.id, role: 'LEAD' } } },
        },
        select: { id: true, controlId: true, status: true, audit: { select: AUDIT_SELECT } },
        orderBy: [{ audit: { plannedEnd: 'asc' } }, { id: 'asc' }],
        take: LIMITS.dashboardItems,
      }),
      this.db.audit.findMany({
        where: { managerId: actor.id, status: 'IN_PROGRESS' },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          plannedEnd: true,
          _count: { select: { evaluations: { where: { status: { not: 'APPROVED' } } } } },
        },
        orderBy: [{ plannedEnd: 'asc' }, { id: 'asc' }],
        take: LIMITS.dashboardItems,
      }),
    ])

    const templates = await this.loadTemplates([...toEvaluateRows, ...toReviewRows])
    const toItem = (row: EvaluationRow) => {
      const node = templates.get(row.audit.templateId)!.tree.pathTo(row.controlId).at(-1)!
      return {
        auditId: row.audit.id,
        auditCode: row.audit.code,
        auditName: row.audit.name,
        evaluationId: row.id,
        control: { reference: node.reference, title: node.title },
        status: row.status,
        plannedEnd: row.audit.plannedEnd,
      }
    }

    return {
      toEvaluate: toEvaluateRows.map(toItem),
      toReview: toReviewRows.map(toItem),
      managing: managingRows.map((row) => ({
        auditId: row.id,
        auditCode: row.code,
        auditName: row.name,
        status: row.status,
        plannedEnd: row.plannedEnd,
        pendingCount: row._count.evaluations,
      })),
    }
  }

  /** Una sola carga por plantilla distinta entre ambas listas (varias auditorías pueden compartirla). */
  private async loadTemplates(rows: readonly EvaluationRow[]): Promise<ReadonlyMap<string, TemplateForAudit>> {
    const templateIds = [...new Set(rows.map((row) => row.audit.templateId))]
    const templates = await Promise.all(templateIds.map((id) => this.library.getTemplate(id)))
    return new Map(templateIds.map((id, index) => [id, templates[index]!]))
  }
}
