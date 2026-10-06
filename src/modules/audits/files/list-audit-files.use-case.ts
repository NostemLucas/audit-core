import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../../../platform/db/index.js'
import {
  evidenceRootFolder,
  FILE_STORAGE,
  type FileStoragePort,
  reportsRootFolder,
} from '../../../platform/nextcloud/index.js'
import { type Actor, assertOnAudit } from '../domain/audit-policy.js'
import { accessOf, loadAudit } from '../infrastructure/audit.queries.js'
import type { ListAuditFilesQueryT } from './audit-files.schemas.js'

@Injectable()
export class ListAuditFilesUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /**
   * Navegación de solo lectura por las carpetas de Nextcloud de la auditoría (Evidencias o Informes), sin entrar
   * criterio por criterio. Las rutas que devuelve son relativas a la sección, así el cliente puede volver a pedirlas
   * tal cual. Una carpeta que todavía no existe en Nextcloud se muestra vacía, no como error.
   */
  async execute(actor: Actor, auditId: string, query: ListAuditFilesQueryT) {
    const audit = await loadAudit(this.db, auditId)
    assertOnAudit('read', actor, await accessOf(this.db, actor, audit))

    const root = query.section === 'INFORMES' ? reportsRootFolder(audit.code) : evidenceRootFolder(audit.code)
    const path = query.path.split('/').filter(Boolean).join('/')
    const entries = await this.storage.listFolder(path ? `${root}/${path}` : root)

    return {
      section: query.section,
      path,
      entries: entries.map((entry) => ({
        name: entry.name,
        path: entry.path.slice(root.length + 1),
        isFolder: entry.isFolder,
        size: entry.size,
        mimeType: entry.mimeType,
        modifiedAt: entry.modifiedAt,
      })),
    }
  }
}
