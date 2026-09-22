import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `assets/compliance-report.docx` se genera con `scripts/build-report-template.mjs` (docs/07 §2). Ruta relativa al
// PROPIO archivo (no al cwd): funciona igual en desarrollo (se ejecuta desde `src/`) y en producción (desde `dist/`,
// donde `nest-cli.json` copia el `.docx` a la misma ruta relativa).
const TEMPLATE_PATH = fileURLToPath(new URL('./assets/compliance-report.docx', import.meta.url))

/** La plantilla por defecto, sin diseño institucional: cada organización sustituye este archivo por el suyo (mismos
 * marcadores, docs/07 §2). Se lee del disco en cada informe (no vale la pena cachear un archivo de unos KB). */
export function loadDefaultTemplate(): Buffer {
  return readFileSync(TEMPLATE_PATH)
}
