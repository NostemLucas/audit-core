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
 * no Nextcloud) y puede trabajar los informes directo ahí (editable, para abrirlos en OnlyOffice sin pasar por acá).
 * Se otorga al agregar un miembro y se revoca al quitarlo — nunca un link, un share por usuario de Nextcloud
 * (`user.username`, el mismo con el que se autentica en Nextcloud).
 */
@Injectable()
export class TeamFolderProvisioningService {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStoragePort) {}

  async grant(auditCode: string, username: string): Promise<void> {
    await Promise.all([
      this.storage.shareWithUser(evidenceRootFolder(auditCode), username, 'READ_ONLY'),
      this.storage.shareWithUser(reportsRootFolder(auditCode), username, 'EDIT'),
    ])
  }

  async revoke(auditCode: string, username: string): Promise<void> {
    await Promise.all([
      this.storage.unshareUser(evidenceRootFolder(auditCode), username),
      this.storage.unshareUser(reportsRootFolder(auditCode), username),
    ])
  }
}
