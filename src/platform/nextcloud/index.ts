export { NextcloudModule } from './nextcloud.module.js'
export { FILE_STORAGE } from './file-storage.port.js'
export type { FileStoragePort } from './file-storage.port.js'
export {
  evaluationIdFromEvidencePath,
  evidenceFolder,
  evidenceRootFolder,
  reportPath,
  reportsRootFolder,
} from './storage-paths.js'
export { verifyWebhookSignature } from './webhook-signature.js'
export { FakeFileStorage } from './testing/fake-file-storage.js'
// `signWebhook` y los tipos `ReadShare`/`UploadedTarget` se piden directo de su archivo (solo los usan pruebas) —
// re-exportarlos aquí sin que nada los consuma DESDE el índice, `knip` los marcaría sin uso (docs/07 §6).
