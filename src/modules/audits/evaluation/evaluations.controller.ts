import { Body, Controller, Get, HttpCode, Param, Put, Query } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import {
  AssignEvaluations,
  type AssignEvaluationsT,
  EvaluationView,
  SetExpectedLevel,
  type SetExpectedLevelT,
  ListEvaluationsQuery,
  type ListEvaluationsQueryT,
} from './evaluation.schemas.js'
import { AssignEvaluationsUseCase } from './use-cases/assign-evaluations.use-case.js'
import { SetExpectedLevelUseCase } from './use-cases/set-expected-level.use-case.js'
import { ListEvaluationsUseCase } from './use-cases/list-evaluations.use-case.js'

/** Los criterios de una auditoría. El contenido de cada uno y su flujo de revisión llegan en 3d. */
@Controller('audits/:auditId')
export class EvaluationsController {
  constructor(
    private readonly list: ListEvaluationsUseCase,
    private readonly assign: AssignEvaluationsUseCase,
    private readonly setExpectedLevel: SetExpectedLevelUseCase,
  ) {}

  @Get('evaluations')
  @Can('read', 'Evaluation')
  @Responds(EvaluationView, { kind: 'list' })
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Query({ schema: ListEvaluationsQuery }) query: ListEvaluationsQueryT,
  ) {
    return this.list.execute(actor, auditId, query)
  }

  /** El líder asigna criterios a un auditor (o los deja sin asignar). Devuelve los que cambiaron. */
  @Put('assignments')
  @HttpCode(200)
  @Can('update', 'Evaluation')
  @Responds(EvaluationView, { kind: 'list' })
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId', { schema: AuditId }) auditId: string,
    @Body({ schema: AssignEvaluations }) body: AssignEvaluationsT,
  ) {
    return this.assign.execute(actor, auditId, body)
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
    return this.setExpectedLevel.execute(actor, auditId, body)
  }
}
