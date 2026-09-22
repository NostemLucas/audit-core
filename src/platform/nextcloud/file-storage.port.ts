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

export interface FileStoragePort {
  /** Crea la carpeta si no existe (idempotente) y un share de solo-subida sobre ella. */
  createUploadTarget(path: string): Promise<UploadTarget>
  /** Sube contenido generado por el backend (un informe); crea las carpetas intermedias que falten. */
  upload(path: string, content: Buffer, mimeType: string): Promise<UploadedFile>
  /** Un share de solo lectura sobre un archivo ya subido. */
  createReadShare(path: string): Promise<ReadShare>
  /** Para `/health/ready`: que el servidor responda, nada más. */
  ping(): Promise<void>
}
