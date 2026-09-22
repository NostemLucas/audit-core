import { Injectable } from '@nestjs/common'
import type { FileStoragePort, ReadShare, UploadedFile, UploadTarget } from '../file-storage.port.js'

/**
 * Nextcloud en memoria, para las pruebas de integración de `evidence`/`reports` (docs/07 §3): no hay Nextcloud real en
 * este repo. Registra lo que se le pidió, sin red; `uploaded` deja inspeccionar el contenido subido en un test.
 */
@Injectable()
export class FakeFileStorage implements FileStoragePort {
  private sequence = 0
  readonly uploadTargets: string[] = []
  readonly uploaded: Array<{ path: string; content: Buffer; mimeType: string }> = []
  readonly readShares: string[] = []

  async createUploadTarget(path: string): Promise<UploadTarget> {
    this.uploadTargets.push(path)
    return { url: `https://nextcloud.test/s/upload-${++this.sequence}` }
  }

  async upload(path: string, content: Buffer, mimeType: string): Promise<UploadedFile> {
    this.uploaded.push({ path, content, mimeType })
    return { fileId: `fake-${++this.sequence}` }
  }

  async createReadShare(path: string): Promise<ReadShare> {
    this.readShares.push(path)
    return { url: `https://nextcloud.test/s/read-${++this.sequence}` }
  }

  async ping(): Promise<void> {}
}
