import { Body, Controller, Get, HttpCode, Param, Put, Query } from '@nestjs/common'
import { type AuthenticatedUser, CurrentUser } from '../../../platform/auth/index.js'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { AuditId } from '../lifecycle/audit.schemas.js'
import {
  AssignEvaluations,
  type AssignEvaluationsT,
  EvaluationView,
  ListEvaluationsQuery,
  type ListEvaluationsQueryT,
} from './evaluation.schemas.js'
import { AssignEvaluationsUseCase } from './use-cases/assign-evaluations.use-case.js'
import { ListEvaluationsUseCase } from './use-cases/list-evaluations.use-case.js'

/** Los criterios de una auditoría. El contenido de cada uno y su flujo de revisión llegan en 3d. */
@Controller('audits/:auditId')
export class EvaluationsController {
  constructor(
    private readonly list: ListEvaluationsUseCase,
    private readonly assign: AssignEvaluationsUseCase,
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
}
