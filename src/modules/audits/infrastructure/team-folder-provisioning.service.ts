import { Inject, Injectable } from '@nestjs/common'
import {
  evidenceRootFolder,
  FILE_STORAGE,
  reportsRootFolder,
  type FileStoragePort,
} from '../../../platform/nextcloud/index.js'

/**
 * Acceso persistente en Nextcloud para el equipo de una auditoría (docs/07 §1.5): mientras alguien sea miembro, ve
 * TODA la evidencia (de solo lectura — el candado real de qué se puede subir/editar lo sigue imponiendo esta API,
 * no Nextcloud) y puede trabajar los informes directo ahí (`EDIT_NO_DELETE`: modificar contenido en OnlyOffice, pero
 * nunca borrar el archivo ni crear otros — esa carpeta solo la llena el backend). Se otorga al agregar un miembro y
 * se revoca al quitarlo — nunca un link, un share por usuario de Nextcloud (`user.username`, el mismo con el que se
 * autentica en Nextcloud). En `infrastructure/` (no en `team/`) porque lo usan dos cortes: `team/` (otorgar/revocar
 * al armar el equipo) y `lifecycle/` (bajar informes a solo lectura al cerrar, `lockReports`).
 */
@Injectable()
export class TeamFolderProvisioningService {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStoragePort) {}

  async grant(auditCode: string, username: string): Promise<void> {
    await Promise.all([
      this.storage.shareWithUser(evidenceRootFolder(auditCode), username, 'READ_ONLY'),
      this.storage.shareWithUser(reportsRootFolder(auditCode), username, 'EDIT_NO_DELETE'),
    ])
  }

  async revoke(auditCode: string, username: string): Promise<void> {
    await Promise.all([
      this.storage.unshareUser(evidenceRootFolder(auditCode), username),
      this.storage.unshareUser(reportsRootFolder(auditCode), username),
    ])
  }

  /**
   * Al cerrar la auditoría: los informes pasan a SOLO LECTURA para todo el equipo — ya no hay razón legítima para
   * seguir modificando el consolidado final (docs/07 §1.5). La evidencia NO se toca: ya era de solo lectura, y
   * conservarla es útil como referencia (p. ej. para un seguimiento posterior). No hay "downgrade" en la API de
   * Nextcloud desde acá: se revoca el share editable y se crea uno nuevo de solo lectura sobre la misma carpeta.
   */
  async lockReports(auditCode: string, usernames: readonly string[]): Promise<void> {
    const path = reportsRootFolder(auditCode)
    await Promise.all(
      usernames.map(async (username) => {
        await this.storage.unshareUser(path, username)
        await this.storage.shareWithUser(path, username, 'READ_ONLY')
      }),
    )
  }
}
