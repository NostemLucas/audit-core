import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../../platform/db/index.js'
import { ENV, type Env } from '../../../../platform/config/index.js'
import { FILE_STORAGE, type FileStoragePort, reportPath } from '../../../../platform/nextcloud/index.js'
import { type Actor, assertOnAudit } from '../../domain/audit-policy.js'
import { accessOf, loadAudit } from '../../infrastructure/audit.queries.js'
import { loadReport } from '../reports.queries.js'

@Injectable()
export class GetReportUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * El informe con dos enlaces (docs/07 §2): `downloadUrl` es un share de solo lectura pedido al vuelo (no se
   * guarda — si expirara o se revocara, se pide uno nuevo sin más). `editUrl` NO es un share nuevo: es el permalink
   * de Nextcloud por fileid (`/f/<id>`), que resuelve distinto para cada usuario según lo que YA tenga compartido —
   * el equipo tiene acceso editable persistente a toda la carpeta `Informes` desde que se lo agrega (§1.5), así que
   * no hace falta pedir nada nuevo acá, solo apuntar al archivo. Abre en Nextcloud/OnlyOffice si está conectado, o
   * en el visor normal si no — nunca fallamos la respuesta por eso, es decisión de la instancia de Nextcloud, no de
   * este backend.
   */
  async execute(actor: Actor, auditId: string, reportId: string) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))
    const report = await loadReport(this.db, auditId, reportId)
    const share = await this.storage.createReadShare(reportPath(audit.code, report.id))
    const editUrl = `${this.env.NEXTCLOUD_BASE_URL}/f/${report.storageFileId}`
    return { ...report, downloadUrl: share.url, editUrl }
  }
}
