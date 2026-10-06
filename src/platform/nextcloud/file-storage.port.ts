/**
 * Lo que este backend necesita de Nextcloud (docs/07 §3). Una sola interfaz para dos usos bien distintos:
 *  - `createUploadTarget`: el CLIENTE sube el archivo directo a Nextcloud; el backend nunca ve los bytes.
 *  - `upload`: el BACKEND sube algo que generó él mismo (un informe).
 * Todas las rutas son las que devuelve `storage-paths.ts` (derivadas de ids estables, nunca de nombres).
 */
export const FILE_STORAGE = Symbol('FILE_STORAGE')

export interface UploadTarget {
  /** URL del share de solo-subida (`UPLOAD_ONLY`) que el cliente usa para hablar directo con Nextcloud. */
  readonly url: string
}

export interface UploadedFile {
  /** Id de Nextcloud del archivo subido: es el `storageFileId` que se guarda. */
  readonly fileId: string
}

export interface ReadShare {
  /** URL de un share de solo lectura, para descargar o abrir en OnlyOffice. */
  readonly url: string
}

export interface FolderEntry {
  readonly name: string
  /** Ruta absoluta dentro de la cuenta de servicio (la misma forma que usan `storage-paths.ts`). */
  readonly path: string
  readonly isFolder: boolean
  /** Solo archivos: bytes. Carpetas: null. */
  readonly size: number | null
  /** Solo archivos: MIME reportado por Nextcloud. Carpetas: null. */
  readonly mimeType: string | null
  /** Última modificación, si Nextcloud la informó. */
  readonly modifiedAt: Date | null
}

/**
 * `READ_ONLY`: ver y descargar. `EDIT_NO_DELETE`: además modificar contenido — para la carpeta de informes, que el
 * equipo trabaja en Nextcloud/OnlyOffice — pero NUNCA borrar ni crear archivos nuevos ahí: esa carpeta solo la llena
 * el backend, y el informe es el consolidado final, no algo que un miembro del equipo pueda hacer desaparecer.
 */
export type SharePermission = 'READ_ONLY' | 'EDIT_NO_DELETE'

export interface FileStoragePort {
  /** Crea la carpeta si no existe (idempotente) y un share de solo-subida sobre ella. */
  createUploadTarget(path: string): Promise<UploadTarget>
  /** Sube contenido generado por el backend (un informe); crea las carpetas intermedias que falten. */
  upload(path: string, content: Buffer, mimeType: string): Promise<UploadedFile>
  /** Un share de solo lectura sobre un archivo ya subido. */
  createReadShare(path: string): Promise<ReadShare>
  /**
   * Comparte una carpeta con UN usuario de Nextcloud (no un link — docs/07 §1.5), sin vencer: dura mientras sea
   * miembro del equipo de la auditoría, se revoca con `unshareUser`. Crea la carpeta si no existe.
   */
  shareWithUser(path: string, username: string, permission: SharePermission): Promise<void>
  /** Revoca lo que `shareWithUser` le dio a ese usuario sobre esa carpeta. Si no había nada que revocar, no es error. */
  unshareUser(path: string, username: string): Promise<void>
  /**
   * Lista los hijos directos de una carpeta (sin la carpeta misma). Una carpeta que todavía no existe da lista vacía,
   * no error: una auditoría sin evidencia subida aún no tiene `Evidencias/`.
   */
  listFolder(path: string): Promise<FolderEntry[]>
  /** Para `/health/ready`: que el servidor responda, nada más. */
  ping(): Promise<void>
}
