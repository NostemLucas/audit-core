# Audit Core — Diseño de evidencia e informes (Fase 4)

Cómo entran los archivos al sistema y cómo salen los informes. Complementa `01` (datos, D14/D15 sobre estos campos),
`02` §6 (`FileStoragePort`, regla 3) y `03` §2.3 (regla 11, efectos externos). El principio de fondo (`01` §0) no cambia
aquí: **el sistema no es dueño de los archivos.** Nextcloud es la fuente de verdad; nosotros guardamos solo la
referencia (`storageFileId`) y los metadatos que ya no hay que preguntarle a Nextcloud para mostrar una lista.

## 1. Evidencia: subida directa + webhook

**El backend nunca recibe el archivo.** El cliente lo sube directo a Nextcloud; nuestro papel es (a) darle un lugar
donde subirlo y (b) que Nextcloud nos avise cuando llegó, para registrar el metadato. Sin subsistema de subida propio
(`01` §0), sin límite de tamaño que administrar aquí (lo impone Nextcloud).

### 1.1 Pedir un lugar para subir

`POST /audits/:auditId/evaluations/:evaluationId/evidence/upload-target` — el **auditor asignado** a ESE criterio (misma
regla que editar su contenido), con la auditoría **evaluable** (`AUDIT_NOT_EVALUABLE`) y el criterio en una ventana
**editable** (`IN_PROGRESS` o `RETURNED`; fuera de ahí, `EVIDENCE_LOCKED` — es la misma ventana que editar el contenido:
lo enviado a revisión no cambia, tampoco su evidencia).

El caso de uso llama al puerto (`FileStoragePort.createUploadTarget(path)`), que:
1. Crea la carpeta si no existe (`MKCOL`, idempotente: un 405 "ya existe" no es error).
2. Crea un share de solo-subida (`UPLOAD_ONLY = 7`, igual que el proyecto anterior: crea y lee lo propio, no borra ni ve
   lo de otros — así un auditor no puede borrar la evidencia de otro con acceso al mismo share), con `expireDate` = HOY
   (la API de Nextcloud solo vence por día, no por hora ni minuto): el share nunca queda vivo para siempre, y como se
   pide uno nuevo cada vez que se llama a este endpoint, la ventana práctica es corta. Mismo mecanismo para el share de
   solo lectura de los informes (§2).
3. Devuelve la URL del share al cliente, que sube el archivo hablando directo con Nextcloud (WebDAV sobre esa URL). El
   backend no interviene en la subida en sí.

**La carpeta se deriva de ids estables, nunca de nombres** (`audits/domain/storage-paths.ts`, función pura):

```
/Auditorias/{audit.code}/Evidencias/{evaluationId}/
```

`code` es estable (se asigna una vez, nunca cambia) y legible para quien mire Nextcloud directamente; `evaluationId` es
estable incluso si el criterio se reasigna o se renombra la plantilla. Nada se guarda: la ruta se recalcula cada vez
que se necesita. Por eso `audits.storageFolderId` **se elimina** (`01` D15, "sin campos sin lector"): guardar un id de
carpeta no ahorra nada si la ruta ya es determinística, y evita que carpeta guardada y ruta derivada puedan divergir.

### 1.2 El webhook

`POST /webhooks/nextcloud/evidence` — `@Public()` (no hay JWT de Authentik: quien llama es Nextcloud, no un usuario).
Se verifica con una firma HMAC-SHA256 sobre el cuerpo crudo, con `NEXTCLOUD_WEBHOOK_SECRET`, en el encabezado
`X-Nextcloud-Signature: sha256=<hex>`; sin firma o firma que no coincide (comparación en tiempo constante) →
`401 WEBHOOK_SIGNATURE_INVALID` (ya en el catálogo de errores desde antes de esta fase).

**Nextcloud no tiene un formato propio de webhook de subida** (varía según versión/app instalada: *Flow*, *Webhook
Listeners*…); en su lugar, este es **el contrato que este backend exige**, y quien administre Nextcloud configura una
regla de *Flow* que lo cumpla (lo documenta el runbook de despliegue, no este repo):

```jsonc
{
  "path": "/Auditorias/AUD-2026-00042/Evidencias/<evaluationId>/acta-comite.pdf",
  "fileId": "nc-83920",       // id de Nextcloud: nuestro storageFileId
  "fileName": "acta-comite.pdf",
  "mimeType": "application/pdf",
  "size": 245678
}
```

El `evaluationId` sale del **propio `path`** (penúltimo segmento): no hace falta que Nextcloud conozca nuestros ids de
ningún otro modo. Con eso:
- Se valida que la evaluación exista y esté en la misma ventana editable que en 1.1 (si alguien alcanzó a completar el
  criterio entre que pidió el lugar y subió el archivo, la evidencia no se registra: `EVIDENCE_LOCKED`).
- Se crea `Evidence` con `title` = el nombre de archivo sin extensión (editable después con un `PATCH`, fuera de esta
  fase por no tener aún un caso de uso que lo pida), `createdById` = el auditor asignado a la evaluación (quien pidió el
  lugar; no viene en el webhook, así que se infiere del asignado — un supuesto documentado, no verificado por firma
  alguna: **quien tenga la URL del share puede subir**, que es la superficie que acepta un share de Nextcloud).
- **Idempotente por `storageFileId` único**: el mismo webhook entregado dos veces (reintento de Nextcloud) no duplica
  la fila; la segunda entrega es `EVIDENCE_ALREADY_REGISTERED`, que el handler trata como éxito (200), no como error
  visible — es la garantía "idempotente y reintentable" de `03` regla 11.

### 1.3 Listar y eliminar

`GET .../evidence` — quien vea el criterio (misma regla que `GET` del criterio). `DELETE .../evidence/:id` — el auditor
asignado, en la misma ventana editable (`EVIDENCE_LOCKED` fuera de ella): soft-delete (`deletedAt`), nunca se borra la
fila (`01`: "único soft-delete del sistema: la evidencia eliminada debe seguir siendo trazable" — si alguien adjunta y
luego retira una evidencia, eso es parte de la historia del criterio). No se borra el archivo en Nextcloud desde aquí:
igual que el registro, es responsabilidad de quien administra el storage (fuera de alcance; ver §5).

## 2. Informes

**Plantilla docx + relleno de datos**, la misma técnica que el proyecto anterior (`docxtemplater` + `pizzip`,
confirmado en su `package.json`; no se inventa un enfoque nuevo donde uno ya probado funciona). El informe generado se
sube a Nextcloud (esta vez SÍ lo sube el backend, con las credenciales de servicio, `FileStoragePort.upload(path,
buffer, mimeType)`) y se edita después en OnlyOffice como cualquier otro documento de Nextcloud — sin código nuestro
para eso: es exactamente la delegación que `01 §0` pide.

`POST /audits/:auditId/reports` — el **manager** o el **líder** (mismo criterio que revisar: quien responde por el
contenido; política contextual nueva, `audit-policy.ts` acción `report`). Exige la auditoría **CERRADA o ARCHIVADA**
(capacidad `reportable`, `audit.lifecycle.ts`; en cualquier otro estado, `409 AUDIT_NOT_REPORTABLE`) — un informe es el
consolidado final, no una foto a medio evaluar llena de huecos y placeholders. (Decisión revisada: la versión original
de esta fase permitía generar en cualquier estado; se corrigió porque en la práctica producía informes con secciones
vacías que nadie quería repartir.) El caso de uso:
1. Junta los datos con los MISMOS cálculos que `GET /results` y `GET /gaps` (`scoring.ts`, `results.queries.ts`): **no
   se inventa una fuente paralela para el informe**.
2. Rellena la plantilla por defecto (`reports/assets/compliance-report.docx`, generada por
   `scripts/build-report-template.mjs`; un `.docx` mínimo con los marcadores de abajo, sin diseño institucional propio:
   cada organización sustituye este archivo por el suyo, mismos marcadores).
3. Sube el resultado a `/Auditorias/{code}/Informes/{reportId}.docx` (el id se genera antes de subir, para que la ruta
   sea determinística desde el principio) y crea `Report` (`type`, `title`, `storageFileId`).
4. **Solo se persiste si la subida tuvo éxito** (`01`: se deja de imitar el `FAILED` + `errorMessage` del proyecto
   anterior — un intento fallido no deja rastro; si Nextcloud no responde, `502 UPSTREAM_UNAVAILABLE` y el cliente
   reintenta el `POST`, sin estado a medias que limpiar).

**Todos los `ReportType` comparten hoy la misma plantilla y los mismos datos** (conteos y brechas): el campo distingue
la intención del informe, no todavía su contenido. Una plantilla distinta por tipo es una extensión futura, no
necesaria mientras nadie la pida.

**Marcadores de la plantilla** (sintaxis de `docxtemplater`, `{campo}` y `{#lista}...{/lista}`), **TODOS planos, sin
notación de punto**:

```
{auditCode} {auditName} {organizationName} {generatedAt}
{evaluated} {meets} {below} {notApplicable} {pending}
{majorCount} {minorCount} {observationCount}
{#domains} {title} {averageExpected} {averageAchieved} {gap} {/domains}
{#gaps} {severity} {domain} {reference} {title} {expectedLabel} {achievedLabel} {findings} {/gaps}
{#controls} {domain} {reference} {title} {depth} {#isLeaf}…{/isLeaf}{^isLeaf}…{/isLeaf} {/controls}
{#results} {domain} {reference} {title} {expectedLabel} {achievedLabel} {#meetsExpected}…{/meetsExpected}{^meetsExpected}…{/meetsExpected} {severity} {findings} {/results}
```

**Catálogo, de más agregado a más detallado** (decidido 2026-09-23, a pedido del usuario: "el peor problema de los
informes es el formato y los snippets"): `domains[]` (promedio por dominio) → `controls[]` (TODOS los nodos —
dominios, agrupadores y hojas — solo estructura, sin datos de evaluación: para mostrar jerarquía y a qué dominio
pertenece cada uno) → `results[]` (TODAS las hojas evaluadas con su resultado completo, cumplan o no — a diferencia
de `gaps[]`, que solo trae las que fallaron) → `gaps[]` (solo lo que quedó por debajo). Cada plantilla usa la
combinación de bucles/marcadores que necesite; `{#tag}`/`{^tag}` de `docxtemplater` sirve como bucle O como
condicional según el tipo del valor (`isLeaf`, `meetsExpected` son booleanos: úsalos para si/no dentro del bucle, sin
necesitar dos colecciones separadas para "todo" vs. "solo lo evaluable").

**Se probó, no se asumió, y se encontró un error real: `docxtemplater` (sin módulos de pago) no entra a un objeto
anidado.** `{overall.evaluated}` no significa "el campo `evaluated` de `overall`": busca la clave literal
`"overall.evaluated"`, no la encuentra, y por defecto escribe el texto **`undefined`** en el documento — sin lanzar
ningún error. La primera versión de esta plantilla usaba esa notación (`overall.evaluated`, `control.title`,
`expectedLevel.label`…) y el primer test de integración que revisó el CONTENIDO del `.docx` (no solo que se generó)
lo encontró. Corrección: `ReportData` es plano (`evaluated`, `meets`… al nivel superior; cada `gaps[]` con `domain`,
`reference`, `title`, `expectedLabel`, `achievedLabel` en vez de objetos anidados) — el caso de uso aplana los datos
al construirlos, la plantilla nunca anida. También se configuró `nullGetter: () => '—'`: sin él, un valor `null`
(un promedio sin nada evaluado) se escribe igual como el texto `undefined`, que en un informe real se leería como
un fallo de la plantilla.

`GET /audits/:auditId/reports` (lista, con la URL de descarga: un share de solo-lectura que el caso de uso pide al
mismo puerto) y `GET .../reports/:id` los ve quien ve la auditoría. La lista de brechas es la MISMA función
(`results/results.queries.ts`, `computeGapViews`) que usa `GET /gaps`: no hay dos sitios que decidan qué es una
brecha.

**Conteo de gravedad** (`06` §3, decidido 2026-09-22): además de listar cada brecha con su gravedad, el informe agrega
un resumen — cuántas mayores, menores y observaciones hay en total (`countBySeverity`, misma función `results.queries.ts`;
las brechas sin clasificar, siempre el caso en madurez, no cuentan en ninguno de los tres). Solo en el informe: `GET
/gaps` no cambia de forma, el resumen es una decisión de presentación del documento, no un dato nuevo que el frontend
necesite por API (puede sumarlo él mismo con lo que ya recibe).

**Gráfico embebido: nivel esperado vs. alcanzado por dominio** (decidido 2026-09-22, revierte la exclusión original de
esta sección). Una barra doble por dominio (gris = esperado, azul = alcanzado si cumple, rojo = alcanzado si queda por
debajo), con los MISMOS promedios que `results.domains` (`GET /results`): corrige el fallo del proyecto anterior
(`04`, "Fallo encontrado…") de usar el máximo de la escala como el objetivo de todos los dominios en vez del promedio
real de cada uno.

- **Sin ningún módulo de imágenes de pago de `docxtemplater`.** La plantilla estática (`build-report-template.mjs`)
  ya trae, fijos, la relación (`word/_rels/document.xml.rels`), el `<w:drawing>` (posición, tamaño declarado en EMU)
  y un PNG placeholder en `word/media/chart1.png`. Lo único que cambia por informe son los BYTES de ese archivo:
  `renderReport(template, data, chartPng)` los reemplaza dentro del zip ya renderizado por `docxtemplater`
  (`rendered.file('word/media/chart1.png', chartPng)`), sin tocar el XML del documento en absoluto. El "marcador" de
  la imagen es, en los hechos, un nombre de archivo fijo dentro del zip — no un `{campo}` de texto.
- **Dibujo del gráfico: SVG a mano, sin ninguna librería de gráficos.** `domain-chart.ts` (función PURA, sin `sharp`
  ni ningún I/O, totalmente unit-testeable) arma el SVG como texto; `chart-renderer.ts` es la ÚNICA pieza que conoce
  `sharp`, y solo para rasterizar ese SVG a PNG. Se evitó a propósito cualquier librería de canvas nativo
  (`node-canvas`, `chartjs-node-canvas`): son dependencias con binarios nativos por plataforma, justo la clase de
  complejidad que el proyecto anterior aisló en "un servicio de canvas aparte, ~200 líneas" — aquí no hace falta:
  `sharp` (Apache-2.0, binarios precompilados, cero dependencias nativas adicionales, ya usado por media internet)
  rasteriza el SVG directamente.
- **Se descartó `docxtemplater-image-module-free`** (el módulo gratuito más conocido para insertar imágenes con
  `docxtemplater`): depende de `xmldom@^0.1.27`, una versión antigua con vulnerabilidades conocidas, sin
  actualizaciones desde 2022. El reemplazo de bytes de archivo (arriba) resuelve lo mismo sin esa dependencia.
- **Tamaño de lienzo FIJO** (`CHART_WIDTH`/`CHART_HEIGHT` en `domain-chart.ts`, hoy 720×380 px): el `<wp:extent>` del
  `.docx` es estático, así que el PNG debe tener siempre las mismas dimensiones o Word lo estira y deforma. Con
  muchos dominios las filas se angostan (hasta un mínimo legible); no hay paginación del gráfico.
- **Verificado abriendo el documento de verdad**, no solo generándolo: `soffice --headless --convert-to pdf` sobre un
  informe con datos reales confirma que LibreOffice (y por transitividad, Word) acepta el XML de la imagen y la
  muestra correctamente — la misma disciplina que ya encontró el bug de `docxtemplater` con notación de punto (`4c`).

### 2.1 Plantilla editable por tipo de informe (`ReportTemplate`, decidido 2026-09-23)

Cada organización puede reemplazar la plantilla de fábrica **por `ReportType`** (COMPLIANCE, GAP_ANALYSIS…) y,
opcionalmente, por **dimensión de escala** (CONFORMITY/MATURITY) — la más específica gana:

1. `(type, dimension)` exacto.
2. `(type, dimension: null)` — el "comodín": aplica a cualquier dimensión de ese tipo.
3. La plantilla de fábrica compilada en el código, si no hay ninguna de las dos anteriores.

**`ReportTemplate` guarda los bytes del `.docx` en la BD, no en Nextcloud**: es configuración del sistema (chica,
poco frecuente), no evidencia de una auditoría — no tiene sentido inventarle una ruta de Nextcloud. Un índice único
normal cubre `(type, dimension)` cuando se indica una dimensión; el comodín (`dimension: null`) necesita un índice
único PARCIAL a mano (Postgres no considera dos `NULL` iguales, así que un `UNIQUE(type, dimension)` normal no
bloquea un segundo comodín del mismo tipo) — mismo patrón que `audit_members_one_lead`.

**Se valida ANTES de guardar, no al generar** (`report-template-validation.ts`): renderiza el `.docx` subido con
datos de prueba que ejercitan TODO el catálogo (ningún campo de esos datos es legítimamente `null`) usando un
`nullGetter` propio que, en vez de escribir "—", ANOTA el nombre del marcador que lo llamó — como ninguno debería
llamarse nunca con datos completos, cualquier llamada es, por descarte, un marcador mal escrito o que no corresponde
a ningún campo. Así se detecta al SUBIR el typo que en la fase 4c solo se encontró inspeccionando un informe real
(`REPORT_TEMPLATE_INVALID`, con el nombre exacto del marcador en `details.markers`). Si el `.docx` es válido pero no
trae `word/media/chart1.png` (el marcador de imagen del gráfico), se guarda igual, con un aviso: una plantilla sin
gráfico es válida, solo no lo mostrará.

**Permisos**: lo administra el GERENTE (como el resto de la biblioteca de contenido — plantillas de controles,
escalas, textos predefinidos), o el ADMIN (que administra catálogos de plataforma); un AUDITOR no lo ve ni lo
administra. Subir un `.docx` distinto para el mismo `(type, dimension)` REEMPLAZA al anterior — no se versiona
(decisión ya tomada aparte: el versionado de contenido no es para este proyecto).

`GenerateReportUseCase` resuelve la plantilla ANTES de renderizar (`findReportTemplate`, `report-template.queries.ts`)
usando la dimensión de la ESCALA de la auditoría (no un campo "tipo de auditoría": no existe tal cosa en el modelo).
`API`: `POST /report-templates?type=&dimension=` (multipart `file`), `GET /report-templates` (lista),
`GET /report-templates/:id` (descarga los bytes tal cual, para editar y volver a subir), `DELETE /report-templates/:id`
(vuelve a la de fábrica).

## 3. El puerto (`FileStoragePort`)

Una sola interfaz en `platform/nextcloud/` (no en `audits/domain/`: lo usan tanto `evidence/` como `reports/`, y no hay
agregado propio que la posea — es infraestructura de E/S, corrección sobre `02` §6, que la listaba junto a los
repositorios de agregado). Un adaptador real HTTP y, en los tests, uno
en memoria (no se necesita un Nextcloud vivo para probar CADA pieza de nuestro lado: firma del webhook, idempotencia,
permisos, contrato de la plantilla — todo eso se prueba sin red. El adaptador HTTP en sí se prueba con un `fetch`
simulado, comprobando que construye las peticiones WebDAV/OCS correctas: no hay forma honesta de probar contra un
Nextcloud real dentro de este repo, y no se afirma haberlo hecho).

```ts
interface FileStoragePort {
  createUploadTarget(path: string): Promise<{ url: string }>
  upload(path: string, content: Buffer, mimeType: string): Promise<{ fileId: string }>
  createReadShare(path: string): Promise<{ url: string }>
}
```

Nota de ubicación: como el puerto también lo usa `reports/` (que no es exclusivamente de `evaluation`), vive en
`platform/nextcloud/` (paralelo a `platform/db/`), no en `audits/domain/` — pequeña corrección sobre `02 §6`, que lo
listaba junto a los repositorios de agregado; aquí no hay agregado, es infraestructura pura de E/S.

## 4. Variables de entorno nuevas

| Variable | Uso |
|---|---|
| `NEXTCLOUD_BASE_URL` | Raíz del servidor (WebDAV y OCS cuelgan de ahí) |
| `NEXTCLOUD_SERVICE_USER` / `NEXTCLOUD_SERVICE_PASSWORD` | Credenciales de la cuenta de servicio (Basic Auth) |
| `NEXTCLOUD_WEBHOOK_SECRET` | Firma HMAC del webhook de evidencia |

`readiness` (`GET /health/ready`) agrega una comprobación de Nextcloud (`PROPFIND` a la raíz, con el mismo timeout que
la de la BD): no bloquea el arranque, informa `checks.nextcloud: 'up' | 'down'` para el balanceador.

## 5. Qué se deja fuera de esta fase (deliberado, se documenta para no reabrir la discusión sin motivo)

- **PDF.** El `.docx` ya se edita en OnlyOffice, que también exporta a PDF con un clic; no se duplica esa conversión
  en el backend salvo que alguien la necesite programáticamente (un endpoint, no una reescritura del generador).
- **Borrar el archivo en Nextcloud al borrar la fila `Evidence`/`Report`.** El soft-delete de `Evidence` ya cubre la
  trazabilidad; sincronizar el borrado físico es una tarea de reconciliación (un job periódico, no una llamada en el
  caso de uso) que se añade si el espacio en disco lo justifica.
- **Provisionar carpetas por adelantado al crear la auditoría.** Se crean perezosamente, en el primer pedido de subida
  (§1.1, `MKCOL` idempotente): más simple que un handler post-commit sobre `AuditCreated`, y no hay ninguna otra
  operación que dependa de que la carpeta exista antes.
- **Editar `Evidence.title`/`description` después de subida.** No hay caso de uso todavía; se agrega si se pide.

### Detalle de 4b (webhook, permisos, pruebas)

- **`useTestApi()` usa `FakeFileStorage` por defecto** en todas las pruebas de integración (antes usaba sin querer el
  adaptador real, que nunca llegaba a ejecutarse porque nada tocaba `FILE_STORAGE`): ningún test habla con una red real,
  y expone `t.storage` para inspeccionar lo que se le pidió (`uploadTargets`, `uploaded`, `readShares`). Se vacía en
  cada test (`beforeEach`, junto con `resetDb`).
- **`rawBody: true`** (`main.ts` y el bootstrap de test) deja los bytes crudos en `request.rawBody`, sin montar un
  body-parser propio: es soporte nativo de Nest 12, no una capa nuestra.
- **El contrato del webhook es propio de este backend** (no de Nextcloud, que no tiene un formato fijo): quien
  administre Nextcloud configura una regla de *Flow* que lo cumpla.
- **Todas las rutas de esta fase pasan por `@Responds(schema)`** (incluida la del webhook, con `@Req()` para leer la
  firma): sin eso, `size` (`BigInt`) rompe la serialización JSON — se encontró probando, no se dio por hecho.

## 6. Cómo se construye (un commit y una etiqueta por paso)

| Paso | Contenido |
|---|---|
| **4a** (hecho) | `platform/nextcloud/` (puerto, adaptador HTTP, firma del webhook), env vars, `storageFolderId` fuera del esquema, `health/ready` con Nextcloud |
| **4b** (hecho) | `audits/evidence/`: pedir lugar de subida, webhook, listar, eliminar |
| **4c** (hecho) | `audits/reports/`: plantilla docx, generar, listar, descargar |
