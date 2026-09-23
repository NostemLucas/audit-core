import { Module } from '@nestjs/common'
import { LibraryModule } from '../library/index.js'
import { OrganizationsModule } from '../organizations/index.js'
import { ApproveEvaluationUseCase } from './evaluation/use-cases/approve-evaluation.use-case.js'
import { CompleteEvaluationUseCase } from './evaluation/use-cases/complete-evaluation.use-case.js'
import { GetEvaluationUseCase } from './evaluation/use-cases/get-evaluation.use-case.js'
import { GetPreviousEvaluationUseCase } from './evaluation/use-cases/get-previous-evaluation.use-case.js'
import { ReopenEvaluationUseCase } from './evaluation/use-cases/reopen-evaluation.use-case.js'
import { ReturnEvaluationUseCase } from './evaluation/use-cases/return-evaluation.use-case.js'
import { UpdateEvaluationUseCase } from './evaluation/use-cases/update-evaluation.use-case.js'
import { EvaluationsController } from './evaluation/evaluations.controller.js'
import { SetExpectedLevelUseCase } from './evaluation/use-cases/set-expected-level.use-case.js'
import { AssignEvaluationsUseCase } from './evaluation/use-cases/assign-evaluations.use-case.js'
import { ListEvaluationsUseCase } from './evaluation/use-cases/list-evaluations.use-case.js'
import { EvidenceController } from './evidence/evidence.controller.js'
import { NextcloudWebhookController } from './evidence/nextcloud-webhook.controller.js'
import { DeleteEvidenceWebhookUseCase } from './evidence/use-cases/delete-evidence-webhook.use-case.js'
import { DeleteEvidenceUseCase } from './evidence/use-cases/delete-evidence.use-case.js'
import { ListEvidenceUseCase } from './evidence/use-cases/list-evidence.use-case.js'
import { RegisterEvidenceUseCase } from './evidence/use-cases/register-evidence.use-case.js'
import { RequestEvidenceUploadUseCase } from './evidence/use-cases/request-evidence-upload.use-case.js'
import { HistoryController } from './history/history.controller.js'
import { GetEvaluationHistoryUseCase } from './history/use-cases/get-evaluation-history.use-case.js'
import { ListAuditHistoryUseCase } from './history/use-cases/list-audit-history.use-case.js'
import { ReportsController } from './reports/reports.controller.js'
import { ReportTemplatesController } from './reports/report-templates.controller.js'
import { GenerateReportUseCase } from './reports/use-cases/generate-report.use-case.js'
import { GetReportUseCase } from './reports/use-cases/get-report.use-case.js'
import { ListReportsUseCase } from './reports/use-cases/list-reports.use-case.js'
import { UploadReportTemplateUseCase } from './reports/use-cases/upload-report-template.use-case.js'
import { ListReportTemplatesUseCase } from './reports/use-cases/list-report-templates.use-case.js'
import { GetReportTemplateUseCase } from './reports/use-cases/get-report-template.use-case.js'
import { DeleteReportTemplateUseCase } from './reports/use-cases/delete-report-template.use-case.js'
import { ResultsController } from './results/results.controller.js'
import { GetAuditResultsUseCase } from './results/use-cases/get-audit-results.use-case.js'
import { ListGapsUseCase } from './results/use-cases/list-gaps.use-case.js'
import { AuditHistoryRecorder } from './audit-history.recorder.js'
import { AuditsController } from './lifecycle/audits.controller.js'
import { CreateAuditUseCase } from './lifecycle/use-cases/create-audit.use-case.js'
import { DeleteAuditUseCase } from './lifecycle/use-cases/delete-audit.use-case.js'
import { GetAuditUseCase } from './lifecycle/use-cases/get-audit.use-case.js'
import { ListAuditsUseCase } from './lifecycle/use-cases/list-audits.use-case.js'
import { ArchiveAuditUseCase } from './lifecycle/use-cases/archive-audit.use-case.js'
import { CloseAuditUseCase } from './lifecycle/use-cases/close-audit.use-case.js'
import { StartAuditUseCase } from './lifecycle/use-cases/start-audit.use-case.js'
import { TransferAuditUseCase } from './lifecycle/use-cases/transfer-audit.use-case.js'
import { UpdateAuditUseCase } from './lifecycle/use-cases/update-audit.use-case.js'
import { TeamController } from './team/team.controller.js'
import { AddMemberUseCase } from './team/use-cases/add-member.use-case.js'
import { ChangeMemberRoleUseCase } from './team/use-cases/change-member-role.use-case.js'
import { ListMembersUseCase } from './team/use-cases/list-members.use-case.js'
import { RemoveMemberUseCase } from './team/use-cases/remove-member.use-case.js'
import { ScopeController } from './scope/scope.controller.js'
import { AddScopeItemUseCase } from './scope/use-cases/add-scope-item.use-case.js'
import { RemoveScopeItemUseCase } from './scope/use-cases/remove-scope-item.use-case.js'

/** `identity` es global (UserDirectory); `organizations` y `library` se importan por su API pública (sus lectores). */
@Module({
  imports: [OrganizationsModule, LibraryModule],
  controllers: [
    AuditsController,
    ScopeController,
    TeamController,
    EvaluationsController,
    ResultsController,
    HistoryController,
    EvidenceController,
    NextcloudWebhookController,
    ReportsController,
    ReportTemplatesController,
  ],
  providers: [
    AuditHistoryRecorder,
    ListAuditsUseCase,
    GetAuditUseCase,
    CreateAuditUseCase,
    UpdateAuditUseCase,
    DeleteAuditUseCase,
    AddScopeItemUseCase,
    RemoveScopeItemUseCase,
    TransferAuditUseCase,
    ListMembersUseCase,
    AddMemberUseCase,
    ChangeMemberRoleUseCase,
    RemoveMemberUseCase,
    ListEvaluationsUseCase,
    AssignEvaluationsUseCase,
    SetExpectedLevelUseCase,
    GetEvaluationUseCase,
    GetPreviousEvaluationUseCase,
    UpdateEvaluationUseCase,
    CompleteEvaluationUseCase,
    ApproveEvaluationUseCase,
    ReturnEvaluationUseCase,
    ReopenEvaluationUseCase,
    StartAuditUseCase,
    CloseAuditUseCase,
    ArchiveAuditUseCase,
    GetAuditResultsUseCase,
    ListGapsUseCase,
    ListAuditHistoryUseCase,
    GetEvaluationHistoryUseCase,
    ListEvidenceUseCase,
    RequestEvidenceUploadUseCase,
    DeleteEvidenceUseCase,
    RegisterEvidenceUseCase,
    DeleteEvidenceWebhookUseCase,
    GenerateReportUseCase,
    ListReportsUseCase,
    GetReportUseCase,
    UploadReportTemplateUseCase,
    ListReportTemplatesUseCase,
    GetReportTemplateUseCase,
    DeleteReportTemplateUseCase,
  ],
})
export class AuditsModule {}
