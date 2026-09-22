export { NextcloudModule } from './nextcloud.module.js'
export { FILE_STORAGE } from './file-storage.port.js'
export type { FileStoragePort } from './file-storage.port.js'
export { evaluationIdFromEvidencePath, evidenceFolder } from './storage-paths.js'
export { verifyWebhookSignature } from './webhook-signature.js'
export { FakeFileStorage } from './testing/fake-file-storage.js'
// `reportPath`, `signWebhook` y los tipos `ReadShare`/`UploadedFile`/`UploadTarget` se exportan cuando 4c (informes) y
// las pruebas del webhook los consuman (docs/07 §6) — hasta entonces `knip` los marcaría como exportados sin uso.
