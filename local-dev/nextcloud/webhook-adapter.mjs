import { createHmac, timingSafeEqual } from 'node:crypto'
import http from 'node:http'

/**
 * Adaptador de webhook, versión "de producción": Nextcloud llama ACÁ en cuanto pasa el evento (empujado por su propia
 * app nativa `webhook_listeners` + un worker de background jobs corriendo en loop — ver docker-compose.yml), no cada
 * X segundos como el sondeo de `webhook-bridge.mjs` (que este archivo reemplaza).
 *
 * docs/07 §1.2 de audit-core es explícito: "Nextcloud no tiene un formato propio de webhook de subida... este es EL
 * CONTRATO QUE ESTE BACKEND EXIGE, y quien administre Nextcloud configura algo que lo cumpla — fuera de este repo."
 * Este adaptador es exactamente esa pieza: traduce el evento NATIVO de Nextcloud (`NodeCreatedEvent`/
 * `NodeDeletedEvent`, registrados vía la API de `webhook_listeners`, ver register-webhooks.sh) al contrato exacto de
 * audit-core, y lo firma con el HMAC que audit-core ya verifica — CERO cambios en audit-core, que es la razón por la
 * que este es el diseño correcto en vez de reescribir el contrato del backend para que hable "nativo Nextcloud": ese
 * contrato interno de Nextcloud puede cambiar de una versión a otra, el de audit-core no debería depender de eso.
 *
 * Por qué no alcanza con leer el evento nativo tal cual: `NodeCreatedEvent`/`NodeDeletedEvent` solo traen
 * `{id, path}` del archivo — ni mimeType ni size (audit-core los pide) — así que además de traducir, esto pide esos
 * dos datos por WebDAV (`statFile`, PROPFIND de un solo archivo) antes de avisarle a audit-core.
 *
 * El borrado es el caso raro en el que SÍ hace falta sondear igual (comprobado en vivo, no una suposición): borrar
 * un archivo por WebDAV lo manda a la papelera de Nextcloud, no lo borra de verdad todavía — y ni ese movimiento NI
 * la purga permanente (`occ trashbin:cleanup`) disparan `NodeDeletedEvent` (confirmado con el log en debug: el
 * listener queda bien registrado, "Listening to NodeDeletedEvent", el evento simplemente no llega). Es una limitación
 * real de Nextcloud para este caso puntual, no un error de este adaptador. Por eso `reconcileDeletions` hace un
 * sondeo periódico (bastante espaciado — es solo la red de contención de un caso raro, la subida ya la avisa Nextcloud
 * al instante) comparando qué archivos siguen estando.
 */
const PORT = Number(process.env.PORT ?? 8091)
const NC_BASE = process.env.NC_BASE
const NC_USER = process.env.NC_USER
const NC_PASS = process.env.NC_PASS
const BACKEND_BASE = process.env.BACKEND_BASE
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET // firma saliente hacia audit-core (ya existía)
const ADAPTER_SECRET = process.env.ADAPTER_SECRET // header estático que Nextcloud manda en cada llamada entrante

if (!NC_PASS || !WEBHOOK_SECRET || !ADAPTER_SECRET) {
  console.error('Faltan NC_PASS, WEBHOOK_SECRET y/o ADAPTER_SECRET en el entorno.')
  process.exit(1)
}

const auth = `Basic ${Buffer.from(`${NC_USER}:${NC_PASS}`).toString('base64')}`
const davMarker = `/${NC_USER}/files` // así arranca el `path` de un FileInfo serializado por Nextcloud (evento nativo)
const propfindMarker = `/remote.php/dav/files/${NC_USER}` // el `d:href` de una respuesta PROPFIND usa este otro formato

const sign = (body) => `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`

const safeEqual = (a, b) => {
  const bufA = Buffer.from(a ?? '')
  const bufB = Buffer.from(b ?? '')
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

async function forward(path, payload) {
  const body = JSON.stringify(payload)
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nextcloud-signature': sign(body) },
    body,
  })
  console.log(`[${new Date().toISOString()}] -> audit-core ${path}: ${res.status}`, payload)
}

/**
 * Nextcloud no manda mimeType/size en el evento nativo — hay que pedírselos por WebDAV. También es la única forma de
 * distinguir un archivo de una carpeta: `NodeCreatedEvent` dispara IGUAL para el `MKCOL` de la carpeta contenedora
 * que para el archivo en sí (mismo tipo de evento, sin un flag "es carpeta" en el payload mínimo que manda
 * Nextcloud) — una carpeta no tiene `d:getcontenttype`, así que su ausencia es la señal de "esto no es un archivo".
 */
async function statFile(relPath) {
  const url = `${NC_BASE}/remote.php/dav/files/${NC_USER}${relPath.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { authorization: auth, depth: '0', 'content-type': 'application/xml' },
    body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getcontenttype/><d:getcontentlength/></d:prop></d:propfind>`,
  })
  const xml = await res.text()
  const mimeType = xml.match(/<d:getcontenttype>([^<]*)<\/d:getcontenttype>/)?.[1] ?? null
  if (!mimeType) return null // carpeta (o algo que ya no existe): no es evidencia
  return {
    mimeType,
    size: Number(xml.match(/<d:getcontentlength>([^<]*)<\/d:getcontentlength>/)?.[1] ?? 0),
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405)
    return res.end()
  }
  if (!safeEqual(req.headers['x-adapter-secret'], ADAPTER_SECRET)) {
    res.writeHead(401)
    return res.end()
  }
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', async () => {
    res.writeHead(204) // a Nextcloud solo le importa 2xx; lo que pase después no debe hacerlo reintentar de más
    res.end()
    try {
      const payload = JSON.parse(raw)
      const eventClass = payload?.event?.class ?? ''
      const node = payload?.event?.node ?? {}
      const fileId = String(node.id ?? '')
      const nodePath = String(node.path ?? '')
      const marker = nodePath.indexOf(davMarker)
      const relPath = marker === -1 ? null : nodePath.slice(marker + davMarker.length)

      if (!fileId || !relPath || !relPath.includes('/Evidencias/')) {
        return // Informes u otra cosa fuera de Evidencias/: no es evidencia, se ignora en silencio
      }

      if (eventClass.endsWith('NodeDeletedEvent')) {
        await forward('/api/v1/webhooks/nextcloud/evidence-deleted', { fileId })
        knownFiles?.delete(fileId)
      } else if (eventClass.endsWith('NodeCreatedEvent')) {
        const stat = await statFile(relPath)
        if (!stat) return // era la carpeta contenedora, no el archivo
        const fileName = relPath.split('/').pop()
        await forward('/api/v1/webhooks/nextcloud/evidence', { path: relPath, fileId, fileName, ...stat })
        knownFiles?.set(fileId, relPath) // para que la reconciliación de borrados ya lo tenga sin esperar su propia pasada
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] error procesando evento de Nextcloud:`, error)
    }
  })
})

server.listen(PORT, () => {
  console.log(`Adaptador de webhook escuchando en :${PORT} (Nextcloud -> aquí -> ${BACKEND_BASE})`)
})

/** Todo lo que hay HOY bajo Evidencias/, como `Map<fileId, path>` — mismo PROPFIND que ya usaba el sondeo original. */
async function listEvidenceFiles() {
  const res = await fetch(`${NC_BASE}/remote.php/dav/files/${NC_USER}/Auditorias`, {
    method: 'PROPFIND',
    headers: { authorization: auth, depth: 'infinity', 'content-type': 'application/xml' },
    body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop><oc:fileid/><d:resourcetype/></d:prop>
</d:propfind>`,
  })
  if (res.status === 404) return new Map()
  if (!res.ok) {
    console.error(`[${new Date().toISOString()}] reconciliación: PROPFIND falló (${res.status})`)
    return null
  }
  const xml = await res.text()
  const files = new Map()
  for (const raw of xml.split('<d:response>').slice(1)) {
    const block = raw.split('</d:response>')[0]
    if (/<d:resourcetype>\s*<d:collection\s*\/>\s*<\/d:resourcetype>/.test(block)) continue
    const href = block.match(/<d:href>([^<]*)<\/d:href>/)?.[1]
    const fileId = block.match(/<oc:fileid>([^<]*)<\/oc:fileid>/)?.[1]
    if (!href || !fileId) continue
    const decoded = decodeURIComponent(href)
    const marker = decoded.indexOf(propfindMarker)
    if (marker === -1) continue
    const relPath = decoded.slice(marker + propfindMarker.length)
    if (relPath.includes('/Evidencias/')) files.set(fileId, relPath)
  }
  return files
}

let knownFiles = null

async function reconcileDeletions() {
  const current = await listEvidenceFiles()
  if (current === null) return // error de red: se reintenta en la próxima pasada, no se pierde el estado conocido

  if (knownFiles === null) {
    knownFiles = current
    console.log(
      `[${new Date().toISOString()}] reconciliación: estado inicial, ${knownFiles.size} archivo(s) de evidencia.`,
    )
    return
  }
  for (const fileId of knownFiles.keys()) {
    if (!current.has(fileId)) {
      await forward('/api/v1/webhooks/nextcloud/evidence-deleted', { fileId })
    }
  }
  knownFiles = current
}

const RECONCILE_INTERVAL_MS = 60_000 // la subida ya llega al instante por push; esto es solo la red de contención del borrado
reconcileDeletions()
setInterval(reconcileDeletions, RECONCILE_INTERVAL_MS)
