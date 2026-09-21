import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common'
import { Can } from '../../../platform/authz/index.js'
import { Responds } from '../../../platform/http/index.js'
import { ControlId } from './control.schemas.js'
import { GetSuggestedFindingsMatrixUseCase } from './use-cases/get-suggested-findings-matrix.use-case.js'
import { RemoveSuggestedFindingUseCase } from './use-cases/remove-suggested-finding.use-case.js'
import { SetSuggestedFindingUseCase } from './use-cases/set-suggested-finding.use-case.js'
import {
  LevelId,
  MatrixQuery,
  type MatrixQueryT,
  SetSuggestedFinding,
  type SetSuggestedFindingT,
  SuggestedFindingsMatrixView,
  SuggestedFindingView,
} from './suggested-finding.schemas.js'
import { TemplateId } from './template.schemas.js'

/**
 * Hallazgos sugeridos: ayuda de redacción por (control, opción de escala). Se editan en cualquier estado de la plantilla
 * (ver SetSuggestedFindingUseCase).
 */
@Controller('templates/:templateId')
export class SuggestedFindingsController {
  constructor(
    private readonly matrix: GetSuggestedFindingsMatrixUseCase,
    private readonly set: SetSuggestedFindingUseCase,
    private readonly remove: RemoveSuggestedFindingUseCase,
  ) {}

  @Get('suggested-findings')
  @Can('read', 'Template')
  @Responds(SuggestedFindingsMatrixView)
  getMatrix(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Query({ schema: MatrixQuery }) query: MatrixQueryT,
  ) {
    return this.matrix.execute(templateId, query.scaleId)
  }

  @Put('controls/:controlId/suggested-findings/:levelId')
  @Can('update', 'Template')
  @Responds(SuggestedFindingView)
  put(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
    @Param('levelId', { schema: LevelId }) levelId: string,
    @Body({ schema: SetSuggestedFinding }) body: SetSuggestedFindingT,
  ) {
    return this.set.execute(templateId, controlId, levelId, body)
  }

  @Delete('controls/:controlId/suggested-findings/:levelId')
  @HttpCode(204)
  @Can('update', 'Template')
  async delete(
    @Param('templateId', { schema: TemplateId }) templateId: string,
    @Param('controlId', { schema: ControlId }) controlId: string,
    @Param('levelId', { schema: LevelId }) levelId: string,
  ): Promise<void> {
    await this.remove.execute(templateId, controlId, levelId)
  }
}
