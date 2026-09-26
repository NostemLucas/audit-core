import { Injectable } from '@nestjs/common'
import { Transactional } from '../../../../platform/db/index.js'
import { type Actor } from '../../domain/audit-policy.js'
import { startAudit } from '../../domain/audit.decider.js'
import { AuditStore } from '../../infrastructure/audit.store.js'
import { withAccess } from '../audit.presenter.js'

@Injectable()
export class StartAuditUseCase {
  constructor(private readonly store: AuditStore) {}

  /**
   * Orden fijo (docs/03 §2.3 regla 4): primero el ciclo de vida, luego las precondiciones, cada una con su propio 422
   * (docs/06 §2): un líder, al menos un auditor, nivel esperado en todas las hojas (en CONFORMITY ya viene fijado al
   * crear) y todos los criterios asignados.
   */
  @Transactional()
  async execute(actor: Actor, id: string) {
    const { view, access } = await this.store.execute(actor, id, (s) => startAudit(s, actor))
    return withAccess(view, actor, access)
  }
}
