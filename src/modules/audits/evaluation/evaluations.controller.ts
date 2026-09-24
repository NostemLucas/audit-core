import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import {
  ApproveEvaluation,
  type ApproveEvaluationT,
  AssignEvaluations,
  type AssignEvaluationsT,
  EvaluationId,
  EvaluationView,
  ListEvaluationsQuery,
  type ListEvaluationsQueryT,
  ReturnEvaluation,
  type ReturnEvaluationT,
  SetExpectedLevel,
  type SetExpectedLevelT,
  UpdateEvaluationContent,
  type UpdateEvaluationContentT,
} from './evaluation.schemas.js'
import { ApproveEvaluationUseCase } from './use-cases/approve-evaluation.use-case.js'
import { AssignEvaluationsUseCase } from './use-cases/assign-evaluations.use-case.js'
import { CompleteEvaluationUseCase } from './use-cases/complete-evaluation.use-case.js'
import { GetEvaluationUseCase } from './use-cases/get-evaluation.use-case.js'
import { GetPreviousEvaluationUseCase } from './use-cases/get-previous-evaluation.use-case.js'
import { ListEvaluationsUseCase } from './use-cases/list-evaluations.use-case.js'
import { ReopenEvaluationUseCase } from './use-cases/reopen-evaluation.use-case.js'
import { ReturnEvaluationUseCase } from './use-cases/return-evaluation.use-case.js'
import { SetExpectedLevelUseCase } from './use-cases/set-expected-level.use-case.js'
import { UpdateEvaluationUseCase } from './use-cases/update-evaluation.use-case.js'

/** Los criterios de una auditoría: lista, asignación, nivel esperado (3c) y el flujo de contenido y revisión (3d). (Tier A, docs/02 §4) */
@Controller('audits/:auditId')
export class EvaluationsController {
  constructor(
    private readonly listUseCase: ListEvaluationsUseCase,
    private readonly getUseCase: GetEvaluationUseCase,
    private readonly getPreviousUseCase: GetPreviousEvaluationUseCase,
    private readonly assignUseCase: AssignEvaluationsUseCase,
    private readonly setExpectedLevelUseCase: SetExpectedLevelUseCase,
    private readonly updateUseCase: UpdateEvaluationUseCase,
    private readonly completeUseCase: CompleteEvaluationUseCase,
    private readonly approveUseCase: ApproveEvaluationUseCase,
    private readonly returnUseCase: ReturnEvaluationUseCase,
    private readonly reopenUseCase: ReopenEvaluationUseCase,
  ) {}

  @Get('evaluations')
  @Can('read', 'Evaluation')
  @Responds(EvaluationView, { kind: 'list' })
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Query({ schema: ListEvaluationsQuery }) query: ListEvaluationsQueryT,
  ) {
    return this.listUseCase.execute(actor, auditId, query)
  }

  @Get('evaluations/:evaluationId')
  @Can('read', 'Evaluation')
  @Responds(EvaluationView)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
  ) {
    return this.getUseCase.execute(actor, auditId, evaluationId)
  }

  /** Cómo quedó este mismo control en la auditoría anterior (solo tiene sentido en un seguimiento). `data: null` si no
   *  es un seguimiento, o si el control es nuevo y no existía en la anterior. */
  @Get('evaluations/:evaluationId/previous')
  @Can('read', 'Evaluation')
  @Responds(EvaluationView.nullable())
  findPrevious(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
  ) {
    return this.getPreviousUseCase.execute(actor, auditId, evaluationId)
  }

  /** El líder asigna criterios a un auditor (o los deja sin asignar). Devuelve los que cambiaron. */
  @Put('assignments')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView, { kind: 'list' })
  putAssignments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Body({ schema: AssignEvaluations }) body: AssignEvaluationsT,
  ) {
    return this.assignUseCase.execute(actor, auditId, body)
  }

  /** El líder fija el nivel esperado (y su guía) de uno o varios criterios. Devuelve los que cambiaron. */
  @Put('expected-levels')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView, { kind: 'list' })
  putExpectedLevel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Body({ schema: SetExpectedLevel }) body: SetExpectedLevelT,
  ) {
    return this.setExpectedLevelUseCase.execute(actor, auditId, body)
  }

  /** El auditor asignado edita el contenido de un criterio. El primer envío lo arranca. */
  @Patch('evaluations/:evaluationId')
  @Can('update', 'Evaluation')
  @Responds(EvaluationView)
  patchContent(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
    @Body({ schema: UpdateEvaluationContent }) body: UpdateEvaluationContentT,
  ) {
    return this.updateUseCase.execute(actor, auditId, evaluationId, body)
  }

  /** El auditor asignado envía el criterio a revisión. */
  @Post('evaluations/:evaluationId/complete')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView)
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
  ) {
    return this.completeUseCase.execute(actor, auditId, evaluationId)
  }

  /** El líder aprueba. Comentario opcional. */
  @Post('evaluations/:evaluationId/approve')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView)
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
    @Body({ schema: ApproveEvaluation }) body: ApproveEvaluationT,
  ) {
    return this.approveUseCase.execute(actor, auditId, evaluationId, body)
  }

  /** El líder devuelve. Comentario obligatorio. */
  @Post('evaluations/:evaluationId/return')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView)
  returnToAuditor(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
    @Body({ schema: ReturnEvaluation }) body: ReturnEvaluationT,
  ) {
    return this.returnUseCase.execute(actor, auditId, evaluationId, body)
  }

  /** El líder reabre uno ya aprobado. Excepcional; comentario obligatorio. */
  @Post('evaluations/:evaluationId/reopen')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView)
  reopen(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Param('evaluationId', { schema: EvaluationId }) evaluationId: string,
    @Body({ schema: ReturnEvaluation }) body: ReturnEvaluationT,
  ) {
    return this.reopenUseCase.execute(actor, auditId, evaluationId, body)
  }
}
