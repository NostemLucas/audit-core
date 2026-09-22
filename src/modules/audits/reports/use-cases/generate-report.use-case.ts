import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../../../../platform/clock/index.js'
import { InjectTx, Transactional, type Tx } from '../../../../platform/db/index.js'
import { EventBus } from '../../../../platform/events/index.js'
import { DOCX_MIME } from '../../../../platform/http/index.js'
import { FILE_STORAGE, type FileStoragePort, reportPath } from '../../../../platform/nextcloud/index.js'
import { LibraryReader } from '../../../library/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { AuditEvents } from '../../domain/events.js'
import { computeResults } from '../../domain/scoring.js'
import { SEVERITY_LABELS } from '../../messages.es.js'
import { findEvaluations } from '../../evaluation/evaluation.queries.js'
import { accessOf, loadAuditView } from '../../infrastructure/audit.queries.js'
import { computeGapViews, countBySeverity, toScoredLeaves } from '../../results/results.queries.js'
import { renderChartPng } from '../chart-renderer.js'
import { buildDomainChartSvg } from '../domain-chart.js'
import { loadReport } from '../reports.queries.js'
import { renderReport } from '../report-renderer.js'
import { loadDefaultTemplate } from '../report.template.js'
import type { GenerateReportT } from '../reports.schemas.js'

@Injectable()
export class GenerateReportUseCase {
  constructor(
    @InjectTx() private readonly tx: Tx,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    private readonly events: EventBus,
    private readonly library: LibraryReader,
  ) {}

  /**
   * Genera un informe con los MISMOS datos que `GET /results` y `GET /gaps` (docs/07 §2: nada de un cálculo paralelo),
   * los mete en la plantilla y sube el resultado a Nextcloud. Solo se persiste si la subida tuvo éxito: un intento
   * fallido no deja rastro (`AuditErrors.REPORT_GENERATION_FAILED` o `PlatformErrors.UPSTREAM_UNAVAILABLE` del puerto).
   */
  @Transactional()
  async execute(actor: Actor, auditId: string, input: GenerateReportT) {
    const audit = await loadAuditView(this.tx, auditId)
    assertOnAudit('report', actor, await accessOf(this.tx, actor, audit))

    const [template, scale, rows] = await Promise.all([
      this.library.getTemplate(audit.templateId),
      this.library.getScale(audit.scaleId),
      findEvaluations(this.tx, auditId),
    ])
    const leaves = toScoredLeaves(rows, template)
    const roots = template.tree.roots()
    const results = computeResults(
      leaves,
      roots.map((root) => root.id),
      scale.levels,
    )
    const gaps = computeGapViews(rows, template)
    const severityCounts = countBySeverity(gaps)
    const domains = results.domains.map(({ domainId: _domainId, ...domain }, index) => ({
      title: roots[index]!.title,
      ...domain,
    }))
    const scaleMax = Math.max(...scale.levels.map((level) => level.value))
    const chartPng = await renderChartPng(buildDomainChartSvg(domains, scaleMax))

    const title = input.title ?? audit.name
    const buffer = renderReport(
      loadDefaultTemplate(),
      {
        auditCode: audit.code,
        auditName: audit.name,
        organizationName: audit.organization.name,
        generatedAt: this.clock.now().toISOString().slice(0, 10),
        evaluated: results.overall.evaluated,
        meets: results.overall.meets,
        below: results.overall.below,
        notApplicable: results.overall.notApplicable,
        pending: results.overall.pending,
        majorCount: severityCounts.MAJOR,
        minorCount: severityCounts.MINOR,
        observationCount: severityCounts.OBSERVATION,
        domains,
        gaps: gaps.map((gap) => ({
          domain: gap.control.domain,
          reference: gap.control.reference,
          title: gap.control.title,
          expectedLabel: gap.expectedLevel?.label ?? null,
          achievedLabel: gap.achievedLevel?.label ?? null,
          findings: gap.findings,
          severity: gap.severity ? SEVERITY_LABELS[gap.severity] : null,
        })),
      },
      chartPng,
    )

    const reportId = randomUUID()
    const uploaded = await this.storage.upload(reportPath(audit.code, reportId), buffer, DOCX_MIME)
    const report = await this.tx.report.create({
      data: { id: reportId, auditId, type: input.type, title, storageFileId: uploaded.fileId },
    })
    await this.events.publish(AuditEvents.ReportGenerated, { auditId, reportId, title })
    return loadReport(this.tx, auditId, report.id)
  }
}
