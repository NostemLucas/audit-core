import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../clock/index.js'
import { ENV, type Env } from '../config/index.js'
import { DomainError, PlatformErrors } from '../errors/index.js'
import type { FileStoragePort, ReadShare, SharePermission, UploadedFile, UploadTarget } from './file-storage.port.js'

/**
 * Adaptador real, por WebDAV (subir, crear carpetas) y la API OCS de *Files sharing* (compartir). Mismos bitmask de
 * permisos que el proyecto anterior (docs/07 §1.1): `READ_ONLY = 1`, `UPLOAD_ONLY = 7`, `EDIT = 15`.
 *
 * Todo share lleva `expireDate` = HOY: nada vive para siempre. La API de Nextcloud solo vence por día (`YYYY-MM-DD`,
 * confirmado contra su documentación — no hay minutos ni horas), así que el share sigue siendo válido el resto del
 * día en que se pidió; como cada descarga/subida ya pide uno nuevo al vuelo, en la práctica la ventana es corta.
 *
 * No hay forma honesta de probar esto contra un Nextcloud real dentro de este repo: se prueba con un `fetch` simulado,
 * verificando que construye las peticiones correctas (`nextcloud-http.client.spec.ts`). Cualquier fallo de red o
 * respuesta inesperada se traduce a `UPSTREAM_UNAVAILABLE` (docs/03 regla 11): nunca se afirma éxito sin confirmarlo.
 */
const PERMISSIONS = { READ_ONLY: 1, UPLOAD_ONLY: 7, EDIT: 15 } as const
const SHARE_TYPE_PUBLIC_LINK = 3
const SHARE_TYPE_USER = 0
const PERMISSION_BITMASK: Record<SharePermission, number> = { READ_ONLY: PERMISSIONS.READ_ONLY, EDIT: PERMISSIONS.EDIT }

@Injectable()
export class NextcloudHttpClient implements FileStoragePort {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createUploadTarget(path: string): Promise<UploadTarget> {
    await this.ensureFolder(path)
    const share = await this.createShare(path, PERMISSIONS.UPLOAD_ONLY)
    return { url: share.url }
  }

  async upload(path: string, content: Buffer, mimeType: string): Promise<UploadedFile> {
    await this.ensureFolder(this.parentOf(path))
    const res = await this.request(this.davUrl(path), {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body: content,
    })
    const fileId = res.headers.get('oc-fileid')
    if (!fileId)
      throw new DomainError(PlatformErrors.UPSTREAM_UNAVAILABLE, { service: 'nextcloud', reason: 'sin oc-fileid' })
    return { fileId }
  }

  async createReadShare(path: string): Promise<ReadShare> {
    const share = await this.createShare(path, PERMISSIONS.READ_ONLY)
    return { url: share.url }
  }

  async shareWithUser(path: string, username: string, permission: SharePermission): Promise<void> {
    await this.ensureFolder(path)
    const body = new URLSearchParams({
      path,
      shareType: String(SHARE_TYPE_USER),
      shareWith: username,
      permissions: String(PERMISSION_BITMASK[permission]),
    })
    await this.request(`${this.env.NEXTCLOUD_BASE_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'ocs-apirequest': 'true' },
      body,
    })
  }

  async unshareUser(path: string, username: string): Promise<void> {
    const shares = await this.listShares(path)
    for (const share of shares) {
      if (share.shareType !== SHARE_TYPE_USER || share.shareWith !== username) continue
      await this.request(
        `${this.env.NEXTCLOUD_BASE_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares/${share.id}?format=json`,
        { method: 'DELETE' },
      )
    }
  }

  async ping(): Promise<void> {
    await this.request(`${this.env.NEXTCLOUD_BASE_URL}/status.php`, { method: 'GET' }, { auth: false })
  }

  /** Crea cada segmento de la ruta que falte (`MKCOL`); un `405` (ya existe) o `409` (la acaba de crear otra petición) no es error. */
  private async ensureFolder(path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean)
    let current = ''
    for (const segment of segments) {
      current += `/${segment}`
      const res = await this.request(this.davUrl(current), { method: 'MKCOL' }, { okStatuses: [201, 405, 409] })
      void res
    }
  }

  private async createShare(path: string, permissions: number): Promise<{ url: string }> {
    const body = new URLSearchParams({
      path,
      shareType: String(SHARE_TYPE_PUBLIC_LINK),
      permissions: String(permissions),
      expireDate: this.clock.now().toISOString().slice(0, 10),
    })
    const res = await this.request(
      `${this.env.NEXTCLOUD_BASE_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'ocs-apirequest': 'true' },
        body,
      },
    )
    const json = (await res.json()) as { ocs?: { data?: { url?: string } } }
    const url = json.ocs?.data?.url
    if (!url)
      throw new DomainError(PlatformErrors.UPSTREAM_UNAVAILABLE, { service: 'nextcloud', reason: 'respuesta sin url' })
    return { url }
  }

  /** Los shares existentes sobre una ruta (para `unshareUser`: hay que borrar por id, la API no borra "por usuario"). */
  private async listShares(path: string): Promise<Array<{ id: string; shareType: number; shareWith: string }>> {
    const res = await this.request(
      `${this.env.NEXTCLOUD_BASE_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(path)}`,
      { method: 'GET' },
    )
    const json = (await res.json()) as {
      ocs?: { data?: Array<{ id: string; share_type: number; share_with: string }> }
    }
    return (json.ocs?.data ?? []).map((d) => ({ id: d.id, shareType: d.share_type, shareWith: d.share_with }))
  }

  private davUrl(path: string): string {
    const encoded = path
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `${this.env.NEXTCLOUD_BASE_URL}/remote.php/dav/files/${encodeURIComponent(this.env.NEXTCLOUD_SERVICE_USER)}/${encoded}`
  }

  private parentOf(path: string): string {
    const segments = path.split('/').filter(Boolean)
    return `/${segments.slice(0, -1).join('/')}`
  }

  private async request(
    url: string,
    init: RequestInit,
    options: { okStatuses?: readonly number[]; auth?: boolean } = {},
  ): Promise<Response> {
    const okStatuses = options.okStatuses ?? [200, 201, 204]
    const auth = options.auth ?? true
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          ...(auth && { authorization: this.basicAuth() }),
        },
      })
    } catch (cause) {
      throw new DomainError(PlatformErrors.UPSTREAM_UNAVAILABLE, { service: 'nextcloud' }, { cause })
    }
    if (!okStatuses.includes(res.status)) {
      throw new DomainError(PlatformErrors.UPSTREAM_UNAVAILABLE, { service: 'nextcloud', status: res.status })
    }
    return res
  }

  private basicAuth(): string {
    return `Basic ${Buffer.from(`${this.env.NEXTCLOUD_SERVICE_USER}:${this.env.NEXTCLOUD_SERVICE_PASSWORD}`).toString('base64')}`
  }
}
