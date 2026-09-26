import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { closeAudit } from '../../domain/audit.decider.js'
import { AuditStore } from '../../infrastructure/audit.store.js'
import { withAccess } from '../audit.presenter.js'

@Injectable()
export class CloseAuditUseCase {
  constructor(private readonly store: AuditStore) {}

  /**
   * Exige todos los criterios APROBADOS, incluidos los «no aplica» (pasan por el mismo flujo de revisión). Efecto:
   * `closedAt`, y los informes del equipo pasan a solo lectura en Nextcloud (docs/07 §1.5: ya no hay razón legítima
   * para seguir editando el consolidado final) — `AuditStore` lo hace después de escribir, solo si el decider lo pide.
   */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const { view, access } = await this.store.execute(actor, id, (s) => closeAudit(s, actor))
    return withAccess(view, actor, access)
  }
}
