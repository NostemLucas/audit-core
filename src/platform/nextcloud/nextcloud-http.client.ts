import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../clock/index.js'
import { ENV, type Env } from '../config/index.js'
import { DomainError, PlatformErrors } from '../errors/index.js'
import type { FileStoragePort, ReadShare, SharePermission, UploadedFile, UploadTarget } from './file-storage.port.js'

/**
 * Adaptador real, por WebDAV (subir, crear carpetas) y la API OCS de *Files sharing* (compartir). Bitmask de
 * permisos de Nextcloud: `READ=1`, `UPDATE=2`, `CREATE=4`, `DELETE=8`, `SHARE=16`. `READ_ONLY=1` es del proyecto
 * anterior (docs/07 §1.1). `UPLOAD_ONLY=5` (READ+CREATE, SIN `UPDATE`) es distinto del proyecto anterior a propósito:
 * el `7` original (READ+UPDATE+CREATE) dejaba sobrescribir un archivo YA subido sin cambiar su `fileId` — quien
 * tuviera el share podía reemplazar el contenido de una evidencia ya registrada sin que este backend se enterara (no
 * hay hash guardado). Sin `UPDATE`, un segundo `PUT` al mismo nombre lo rechaza Nextcloud (403), no lo permite en
 * silencio; quien sube debe usar un nombre nuevo para un archivo nuevo. No se compensa esto guardando un hash o un
 * estado paralelo en la BD: la fuente de verdad del archivo es Nextcloud, y una segunda fuente (nuestra BD) tratando
 * de reflejar lo mismo se desincroniza rápido — si algún día hace falta *detectar* un intento de sobrescritura, la
 * vía es un webhook de Nextcloud (como evidencia/borrado, docs/07 §1.2-1.3), no una comparación desde acá.
 * `EDIT_NO_DELETE=3` (READ+UPDATE, SIN CREATE ni DELETE) es propio de acá también: el equipo puede abrir y modificar
 * un informe en OnlyOffice (docs/07 §1.5), pero NUNCA borrarlo ni crear archivos nuevos ahí — la carpeta de informes
 * solo la llena el backend (`upload()`, cuenta de servicio); un `MEMBER` con permiso de borrar podría eliminar el
 * consolidado final sin que quede más rastro que el `Report` en la BD apuntando a un archivo que ya no existe.
 *
 * Todo share lleva `expireDate` = MAÑANA: nada vive para siempre. La API de Nextcloud solo vence por día
 * (`YYYY-MM-DD`, confirmado contra su documentación — no hay minutos ni horas). MAÑANA y no HOY, a propósito: un
 * servidor real rechaza una fecha de vencimiento que ya pasó ("Expiration date is in the past") — HOY puede leerse
 * como "ya pasado" según la hora y la zona horaria del servidor de Nextcloud, que no controlamos desde acá. Como
 * cada descarga/subida ya pide un share nuevo al vuelo, en la práctica la ventana de uso es corta de todos modos.
 *
 * No hay forma honesta de probar esto contra un Nextcloud real dentro de este repo: se prueba con un `fetch` simulado,
 * verificando que construye las peticiones correctas (`nextcloud-http.client.spec.ts`). Cualquier fallo de red o
 * respuesta inesperada se traduce a `UPSTREAM_UNAVAILABLE` (docs/03 regla 11): nunca se afirma éxito sin confirmarlo.
 */
const PERMISSIONS = { READ_ONLY: 1, UPLOAD_ONLY: 5, EDIT_NO_DELETE: 3 } as const
const SHARE_TYPE_PUBLIC_LINK = 3
const SHARE_TYPE_USER = 0
const PERMISSION_BITMASK: Record<SharePermission, number> = {
  READ_ONLY: PERMISSIONS.READ_ONLY,
  EDIT_NO_DELETE: PERMISSIONS.EDIT_NO_DELETE,
}

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

  /**
   * IDEMPOTENTE por diseño propio (no por interpretar un código de error de Nextcloud, que no se puede verificar sin
   * un servidor real): antes de crear, lista lo que ya hay. Si el usuario YA tiene exactamente ese permiso sobre esa
   * ruta, no hace nada — evita el 502 de "ya compartido" al reintentar tras una falla parcial (p. ej. si `grant()`
   * comparte una de las dos carpetas y falla en la otra, un reintento no debe romperse en la que sí funcionó). Si lo
   * tiene con OTRO permiso, lo reemplaza (borra y crea de nuevo — la API no tiene "actualizar permisos" por acá).
   */
  async shareWithUser(path: string, username: string, permission: SharePermission): Promise<void> {
    await this.ensureFolder(path)
    const bitmask = PERMISSION_BITMASK[permission]
    const existing = (await this.listShares(path)).find(
      (s) => s.shareType === SHARE_TYPE_USER && s.shareWith === username,
    )
    if (existing?.permissions === bitmask) return
    if (existing) {
      await this.request(
        `${this.env.NEXTCLOUD_BASE_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares/${existing.id}?format=json`,
        { method: 'DELETE' },
      )
    }
    const body = new URLSearchParams({
      path,
      shareType: String(SHARE_TYPE_USER),
      shareWith: username,
      permissions: String(bitmask),
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
      // MAÑANA, no hoy: un `expireDate` de hoy es, para Nextcloud, una fecha que ya pasó (o está por pasar en
      // cualquier momento) — un servidor real la rechaza ("Expiration date is in the past"). No hay forma de acertar
      // el huso horario exacto del servidor de Nextcloud desde acá (expireDate es solo fecha, sin hora ni zona), así
      // que "mañana" en UTC es el margen simple y seguro: nunca queda en el pasado, sea cual sea esa zona.
      expireDate: new Date(this.clock.now().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
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

  /** Los shares existentes sobre una ruta (para `unshareUser`: hay que borrar por id, la API no borra "por usuario";
   * y para que `shareWithUser` sea idempotente sin adivinar el formato de error de Nextcloud). */
  private async listShares(
    path: string,
  ): Promise<Array<{ id: string; shareType: number; shareWith: string; permissions: number }>> {
    const res = await this.request(
      `${this.env.NEXTCLOUD_BASE_URL}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(path)}`,
      { method: 'GET' },
    )
    const json = (await res.json()) as {
      ocs?: { data?: Array<{ id: string; share_type: number; share_with: string; permissions: number }> }
    }
    return (json.ocs?.data ?? []).map((d) => ({
      id: d.id,
      shareType: d.share_type,
      shareWith: d.share_with,
      permissions: d.permissions,
    }))
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
