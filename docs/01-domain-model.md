# Audit Core — Modelo de dominio y de datos (borrador v1)

Estado: **propuesta para revisión**. Nada de esto está implementado. Reemplaza el backend `audit-final2`
(NestJS + TypeORM) por un proyecto nuevo con NestJS + Prisma.

## 0. Premisas

- **Un solo tenant.** Las organizaciones son **a quién auditamos**, no inquilinos. No hay aislamiento por
  organización ni condiciones CASL por organización.
- **Sin datos que migrar.** Esquema nuevo + seeds.
- **Autenticación en Authentik**, archivos en **Nextcloud + OnlyOffice**. Igual que hoy.
- **El frontend se rediseña aparte.** El contrato HTTP nuevo no busca compatibilidad con el actual.
- **Solo entra lo que se usa.** Lo que hoy no tiene consumidor real no se lleva; se deja un punto de
  extensión (§6) para agregarlo después sin tocar lo existente.
- **No somos dueños de datos ajenos.** Identidad → Authentik; archivos → Nextcloud; direcciones, teléfonos y contactos de
  una empresa → su contrato o CRM. Un dato entra al modelo solo si una función del sistema lo consume; agregar una columna
  después es una migración aditiva sin riesgo, quitarla con datos cargados no.
- **Sin soft-delete genérico.** Estado explícito (`status` o `isActive`, ver [`03-state-standard.md`](./03-state-standard.md)) y borrado físico cuando es
  seguro (borradores). Solo la evidencia conserva `deletedAt`.

## 1. Decisiones de diseño

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Plantilla = una norma completa**, identificada por su `name` único (p. ej. `ISO/IEC 27001:2022`). Se eliminan `code` y `version`. | ISO no publica parches: una edición por año. La versión ya va en el nombre. Una variante paralela es simplemente otra plantilla con otro nombre. Se van `suggestNextVersion` y su lógica de colisiones. |
| D2 | El estado de la plantilla (`DRAFT → PUBLISHED → ARCHIVED`) **se mantiene**. Se eliminan `publishedAt` y `archivedAt`. | El estado decide si se puede editar y si se puede auditar con ella. Las fechas no las consume nadie. |
| D3 | Una plantilla **PUBLISHED es inmutable**. Corregir = clonar (`name` nuevo) y trabajar en la copia DRAFT. | Hoy el contenido publicado se puede editar y una auditoría en curso cambia por debajo. Inmutable permite que la auditoría referencie los controles sin copiarlos. |
| D4 | Un único árbol de **controles** por plantilla. **Evaluable = hoja.** Se eliminan `level` e `isAuditable`. | Hoy hay dos reglas para lo mismo (`isAuditable` en 28 sitios; el inicializador usa "hoja"). La profundidad se calcula al armar el árbol en memoria. |
| D5 | Se mantiene una tabla `templates` mínima (cabecera) en vez de un nodo raíz en el árbol. Los capítulos de primer nivel tienen `parentId = NULL`. | La cabecera lleva el `status`. En un nodo raíz, ese campo quedaría nulo en todos los demás nodos y haría falta un trigger para asegurar que la auditoría apunte a una raíz. |
| D6 | `AuditResponse` + `AuditEvaluation` se fusionan en **`evaluations`**: la evaluación de un control dentro de una auditoría. El estado vigente vive en la fila; el historial es un log append-only `evaluation_reviews`. | Hoy hay dos fuentes de verdad (`isCurrent` y `currentEvaluationId`) y un servicio solo para sincronizarlas. "Response" además no dice qué es. |
| D7 | "Revisión" se separa en dos: **seguimiento** (`audits.parentAuditId`, nueva auditoría sobre una cerrada) y **ronda** (`evaluations.round`, ciclo devolver/corregir). | Hoy una sola palabra nombra ambas cosas. |
| D8 | `frameworks`/`framework_levels` pasan a **`scales`/`scale_levels`**, y quedan **mínimas**: `name` + `dimension` (`CONFORMITY | MATURITY`) + `isActive`; opciones con `value` (su **puntaje**), `label`, `description?`. Sin `type`, `code`, `description`, `color`, `shortName` ni `position`. La escala es donde vive el concepto de "cómo se puntúa" (`05` §11). | "Framework" se confundía con la norma. Y lo que quedaba era presentación o derivable: el `type` solo lo leía un validador (`BINARY` = 2 niveles; `RANGE` = enteros consecutivos, que no cambia ningún cálculo); el orden es el del `value`; el color lo deriva el frontend. Los informes solo leen `name`, `label`, `value` y `description`. Ver §2.2. |
| D9 | **Alcance propio de la auditoría**: `audit_scope_items` (solo un nombre) dentro de cada auditoría. Sin catálogo de activos por organización, sin `scopeMode`. | Se define **en el momento** de la auditoría qué se audita. Un seguimiento hereda una **copia** del alcance y no puede ampliarlo: incluir algo distinto ya no es seguimiento, es otra auditoría. Con un catálogo reutilizable ese rechazo no tendría fundamento. Ver §3. |
| D10 | **Se eliminan `global_feed` y `notifications`** del alcance inicial. Queda **`audit_events`**, el historial de cada auditoría. | Definir qué notificar y a quién es una decisión de producto que hoy no está tomada; las tablas solo agregan peso. El historial de auditoría sí se usa (19 puntos de escritura). Se agregan después vía §6. |
| D11 | Los eventos se guardan como **`type + payload`**, sin texto. El mensaje se genera al leer. | Congelar prosa en español impide cambiar redacción o idioma. |
| D12 | **Textos predefinidos → `suggested_findings`** (hallazgo sugerido por control y nivel). Solo existen filas con texto real. | Ver §4. |
| D13 | Se elimina `audits.description` (no aparece en informes). **La guía del auditor se elimina de la plantilla** y no se reintroduce por auditoría: lo institucional es el nivel esperado y su motivo (`evaluations.expectedLevelReason`). Ver `04` §4.4, que corrige el razonamiento original de este punto. | Una guía en la plantilla hay que reescribirla o limpiarla en cada auditoría porque depende de la institución. |
| D14 | Los valores derivables no se guardan: `achievedEvaluationLevel`, `expectedEvaluationLevel`, `WorkPaper.type`, `fileSizeFormatted`, `nextcloudFolderPath`, `level`, `actorName`. **Tampoco `weight`, `score` ni `finalScore`** (revisado en la fase 2; antes el `score` sí se guardaba). | Menos columnas que puedan divergir. No hay pesos manuales (`05` §6): cada hoja evaluable y aplicable cuenta igual, y los resultados se derivan de nivel esperado y alcanzado cuando se piden. Un resultado congelado al cerrar vendrá del informe generado, no de una columna. |
| D15 | **Sin campos sin lector.** Se quitaron: `Template.description`, `Audit.startedAt` (solo la escribía la máquina de estados; el momento queda en el evento `AuditStarted`), `AuditMember.notes`, `Report.fileName`/`size` (de Nextcloud; el nombre de descarga se deriva del título) y las columnas de `Scale`/`ScaleLevel` citadas en D8. | Verificado contra el proyecto anterior campo por campo (lectores reales, no DTOs ni Swagger). Ver el principio de §0. |

## 2. Modelo de datos objetivo

Todas las tablas llevan `id uuid` (UUIDv7, ordenable por tiempo), `createdAt` y `updatedAt` (`Timestamptz`),
salvo puentes y logs. Las **raíces de agregado** (`organizations`, `scales`, `templates`,
`audits`, `evaluations`, `evidences`, `reports`) llevan además los sellos `createdById` / `updatedById`: ids
planos **sin FK**, que rellena una Prisma client extension; el nombre se hidrata con un `UserDirectory`. Es la
única excepción a "toda referencia a un usuario lleva FK". Con esto `evidences.createdById` **es** quien subió el
archivo y `reports.createdById` quien generó el informe: no hay un campo aparte que duplique el dato.

El SQL exacto (incluidas las restricciones que Prisma no modela) está en
`prisma/migrations/*_init/migration.sql`; ver §2.1.

### Identidad y auditados
- **users** (espejo **mínimo** de Authentik; solo lo que el sistema usa): `authentikId` UQ (`sub`), `email` UQ (minúsculas,
  CHECK), `username` UQ (`preferred_username` **tal cual**: es el usuario de Nextcloud al compartir carpetas y este
  distingue mayúsculas), `name` (claim `name`; Authentik no entrega apellidos por separado de forma fiable), `roles
  Role[]` (desde los grupos). Sin `ci`/`phone` (nadie los consumía), sin `isActive` (`03` §4) y sin sellos de
  auditoría (nadie "crea" a un usuario: lo crea su propio login). Nunca se borran (el resto del sistema los referencia).
- **organizations** (a quién auditamos): `name` UQ, `isActive`. Solo la referencia del auditado, para agrupar auditorías y
  activos. Sin dirección, teléfono, email ni descripción: ninguna función los consumía (los informes usan solo el nombre) y
  el sistema es de auditorías, no de datos de organizaciones. Si eso se necesita, lo gestionará otro sistema y aquí se
  enlazará con un `externalId` (columna nueva, migración aditiva; no se agrega antes de que exista esa integración). Un
  contacto útil es una **persona con rol** (`contacts`), no columnas de la organización. No se borran si tienen auditorías.
### Biblioteca
- **scales**: `name` UQ, `dimension` (`CONFORMITY | MATURITY`: solo cambia la etiqueta y la vista principal del resultado y el nivel
  esperado sugerido, no el cálculo; `05` §11), `isActive`. Una lista ordenada de opciones con etiqueta y **puntaje** (ver §2.2).
- **scale_levels** (las opciones): `scaleId` FK, `value Decimal(5,2)` (el puntaje), `label`, `description?`. UQ(`scaleId`, `value`).
  Orden = orden del `value`. El puntaje no se edita una vez usada la escala en una auditoría (regla de dominio, `SCALE_LEVEL_VALUE_LOCKED`).
- **templates**: `name` UQ, `status` (`DRAFT | PUBLISHED | ARCHIVED`).
- **controls**: `templateId` FK (cascade), `parentId?` FK→controls (cascade), `reference?` (numeración de la norma tal como la
  escribe la plantilla; texto libre, **no único, sin lógica**), `title` (en una hoja ES el criterio), `description?`, `position`
  (el orden es explícito). Índice (`templateId`, `parentId`, `position`). Sin `code` ni `guidance` (`04` §4).
  **FK compuesta** (`parentId`, `templateId`) → controls(`id`, `templateId`): la BD garantiza que el padre es de
  la misma plantilla.
  Se carga completo por plantilla (cientos de nodos) y el árbol se arma en memoria.
- **suggested_findings**: `controlId` FK (cascade), `levelId` FK→scale_levels, `text`. UQ(`controlId`, `levelId`).

### Auditorías
- **audits**: `code` UQ (secuencia de Postgres, sin `findByCode` + reintento), `name`, `introduction?`,
  `scopeNotes?`, `objectives?`, `templateId` FK, `organizationId` FK, `scaleId` FK, `managerId` FK→users,
  `parentAuditId?` FK→audits, `followUpNumber` (0 = inicial), `status` (`DRAFT|IN_PROGRESS|CLOSED|ARCHIVED`),
  `plannedStart?`, `plannedEnd?`, `closedAt?`,
  `storageFolderId?` (la ruta se deriva del `code`; se revisa en la fase de evidencia), `version` (bloqueo optimista).
  Se eliminan `description`, `publishedAt`, `archivedAt`, `startedAt`, `scopeMode`, `overallScore`, `finalScore` y
  `nextcloudFolderPath`.
- **audit_scope_items**: `auditId` FK (cascade), `name`. UQ(`auditId`, `name`). Sin elementos = toda la organización.
- **audit_members**: `auditId`, `userId`, `role` (`LEAD_AUDITOR | INSPECTOR`). UQ(`auditId`, `userId`).
  Quitar un miembro es un borrado; queda en `audit_events`.
- **evaluations** (una por auditoría × control **hoja**): `auditId` FK, `controlId` FK,
  `expectedLevelId?` FK (nulo solo en DRAFT: iniciar la auditoría lo exige en cada hoja; por criterio, no por auditoría) y `expectedLevelReason?` (por qué ese nivel en esta auditoría), `assignedUserId?` FK, `status`
  (`NOT_STARTED|IN_PROGRESS|COMPLETED|RETURNED|APPROVED`), `round` (desde 1), `achievedLevelId?` FK,
  `findings?`, `notes?`, `isNotApplicable`, `notApplicableReason?`, `version`.
  UQ(`auditId`, `controlId`). Índices (`auditId`, `status`) y (`assignedUserId`, `status`).
  Sin `weight` ni `score`: los resultados se derivan (`05` §6, §11).
  CHECK: `isNotApplicable` ⇒ `notApplicableReason` no nulo.
- **evaluation_reviews** (log append-only): `evaluationId` FK, `round`, `action`
  (`APPROVE|RETURN|REASSIGN|REOPEN|RESTORE`), `actorId` FK, `comments?`, `snapshot jsonb` (nivel,
  hallazgos, notas, N/A, ids de evidencia; tipado con Zod), `createdAt`. Restaurar una ronda lee el snapshot.
- **evidences** (antes `work_papers`): `evaluationId` FK, `round`, `title`, `description?`, `fileName`, `mimeType`,
  `size BigInt`, `storageFileId` UQ NOT NULL (fuente de verdad en Nextcloud), `deletedAt?` (único soft-delete del
  sistema: la evidencia eliminada debe seguir siendo trazable). Quién la subió: `createdById`.
  Ya no existen `source='legacy'`, `status`, `type`, `remotePath`, `uploadedBy`, `auditId` ni `standardId`.
- **reports**: `auditId` FK, `type`, `title`, `storageFileId` UQ. Solo se guarda si la generación tuvo éxito (hoy se
  persisten también los FAILED con `errorMessage`). Nombre y tamaño del archivo no se copian: son de Nextcloud.
### Historial
- **audit_events** (log append-only): `auditId` FK NOT NULL, `type`, `actorId?` FK, `targetUserId?` FK,
  `subjectType`, `subjectId`, `payload jsonb` (Zod discriminado por `type`), `createdAt`.
  Índices (`auditId`, `createdAt`) y (`subjectType`, `subjectId`).

### 2.1 Integridad que garantiza la BD (verificada contra Postgres 17)

| Regla | Mecanismo |
|-------|-----------|
| El padre de un control es de la misma plantilla | FK compuesta en `controls` |
| No se borra una organización / plantilla / escala / control en uso | FK `onDelete: Restrict` (la cascada plantilla → controles también se bloquea si hay evaluaciones) |
| Una evaluación por control y auditoría; un miembro por auditoría | UNIQUE |
| N/A exige motivo; `round ≥ 1` | CHECK en `evaluations` |
| Seguimiento coherente: `parentAuditId` nulo ⇔ `followUpNumber = 0`; no es su propio padre; fechas ordenadas | CHECK en `audits` |
| `email` y `username` en minúsculas | CHECK en `users` |
| Puntaje de una opción ≥ 0; `payload` y `snapshot` son objetos JSON | CHECK |
| Código de auditoría correlativo sin carreras | Secuencia `audit_code_seq` |
| Orden de los nombres que se listan (`organizations.name`; las demás columnas de nombre al llegar su módulo) | Collation ICU `und-x-icu` en la columna: sin ella el orden depende de cómo se creó la base (con la de la imagen de prueba `alfa` iba después de `Delta`). Prisma no la modela; está en el bloque manual de la migración |

Lo que **no** se puede expresar en la BD y queda como regla de dominio: el
nivel elegido pertenece a la escala de la auditoría; las invariantes de la escala (§2.2); el alcance solo se edita en `DRAFT` y un seguimiento no puede modificarlo;
solo se evalúan hojas.

### 2.2 Escalas: invariantes (reemplazan a los antiguos tipos RANGE / BINARY / QUALITATIVE)

El código anterior validaba los niveles según un `type`: comunes a todos (≥ 1 nivel, valores y etiquetas únicos),
`BINARY` = exactamente 2 niveles incluyendo el 0, `QUALITATIVE` = ≥ 2 niveles de cualquier valor y `RANGE` =
enteros consecutivos. Como `QUALITATIVE` ya admite cualquier conjunto, la única diferencia real era la
consecutividad, y eso **no interviene en ningún cálculo**. Sin `type`, una
escala válida cumple una sola lista (función de dominio en `library`, `SCALE_LEVELS_INVALID` con `details.rule`):

| Regla | `rule` |
|-------|--------|
| Al menos 2 opciones | `MIN_LEVELS` |
| Valores únicos (la BD lo garantiza con UNIQUE) | `DUPLICATE_VALUE` |
| Etiquetas únicas, sin distinguir mayúsculas ni espacios | `DUPLICATE_LABEL` |
| El puntaje máximo es > 0 | `MAX_MUST_BE_POSITIVE` |

"Binaria" es simplemente `niveles.length === 2`; el frontend decide cómo dibujarla. La regla antigua "un nivel
debe valer 0" no se conserva: no protege ningún cálculo.

## 3. Alcance de la auditoría (D9)

- Se define **dentro de la auditoría, en el momento de crearla**: `audit_scope_items`, cada uno solo un nombre
  ("ERP", "Sede Sur", "Proceso de compras"). `scopeNotes` sigue siendo el texto libre para el redactado del informe.
- **Sin elementos = toda la organización.** No hay un `scopeMode`: se deriva de los elementos (estándar `03` §1).
- Solo se edita con la auditoría en `DRAFT` (capacidad `editable`).
- **Un seguimiento hereda una copia del alcance** de la auditoría a la que sigue y **no puede modificarlo**
  (`AUDIT_SCOPE_INHERITED`). Si el cliente quiere incluir algo que no estaba, ya no es un seguimiento: es otra auditoría.
- No hay catálogo de activos por organización. La consulta "todas las auditorías donde se evaluó el activo X" deja de
  existir; el historial de un alcance se sigue por la cadena de seguimientos (`parentAuditId`).

**Fuera de alcance a propósito:** evaluar un mismo control por separado para cada elemento dentro de una misma
auditoría. Añade una dimensión a `evaluations` y a los pesos. Si se necesita, una auditoría por elemento.

## 4. Textos predefinidos → `suggested_findings` (D12)

Qué hace hoy: cuando el auditor elige un nivel de madurez para un control, el sistema **copia un texto de
hallazgo pre-redactado** (`control × nivel`) al campo `findings` si aún está vacío. Es ayuda de redacción.

Qué se cambia:
- Se guarda solo lo que alguien escribió. La matriz completa (control × nivel) se calcula al leer, con huecos.
  Se eliminan los casos de uso `initialize` y `bulk-initialize` (creaban filas vacías).
- El texto pertenece a un `scale_level`, por lo tanto solo aplica cuando la auditoría usa esa escala. La
  interfaz muestra la matriz de una plantilla **para una escala elegida**.
- Se copia solo si `findings` está vacío y se guarda como texto normal; después no hay vínculo con la sugerencia.
- Vive en la biblioteca junto a las plantillas (inmutable al publicar, igual que los controles).
- Importación y exportación por Excel: se conservan.

## 5. Qué se conserva del proyecto actual

El análisis de brechas (con la fórmula de resultados rediseñada: `05` §6 y §11, sin pesos); reglas de transición de auditoría y evaluación (ahora como tabla tipada `defineLifecycle`, sin XState; ver `03`); clonado de plantillas; CASL con su test de
cobertura de rutas; sincronización con Authentik (`protectLastAdmin`, reintentos por unique); provisioning y
shares de Nextcloud (`READ_ONLY=1`, `UPLOAD_ONLY=7`, `EDIT=15`), webhooks y OnlyOffice; contenido de los seeds
(ISO 27001, ASFI, COBIT 5, CMMI, binaria, cualitativa); informes docx; import/export Excel; Sentry y throttling.

**No se conserva:** `BaseRepository`, `@Transactional()` por monkey-patching, logger propio (2.6k líneas), i18n
propio (2.4k), decoradores swagger propios y `swagger.cli`, `_shared/` como cajón de sastre,
`global_feed`, `notifications` (+ `NotificationEmailService` no-op y su dispatcher), el monitor de plazos (solo
existía para generar notificaciones; vuelve con ellas), sidebar calculado en backend, getters-fachada,
`eager: true`, `noImplicitAny: false`.

## 6. Enfoque de arquitectura y cómo se extiende sin romper

> El detalle (fuente única por concepto, tiers de módulo, recetas, reglas impuestas por CI) está en
> [`02-architecture.md`](./02-architecture.md). Esta sección es solo el resumen.

**Monolito modular con cortes verticales; núcleo de dominio solo donde hay reglas; eventos de dominio síncronos
dentro de la transacción.**

Por qué este y no otro:
- *Hexagonal completa en todo* añade capas donde no hay reglas (organizaciones, usuarios, escalas serían
  CRUD con 4 archivos por operación). Justo la complejidad que quieres quitar.
- *CQRS/event sourcing/microservicios* no se justifican: un tenant, un equipo, proyecto consolidado.
- *Un `services/` plano por módulo* es lo que hay hoy y termina mezclando responsabilidades.

Reglas:
1. **Módulos Nest**: `identity`, `organizations`, `library`, `audits`, `reporting`, `dashboard`, `platform`.
   `audits` es **un** módulo con carpetas por funcionalidad (`lifecycle/`, `team/`, `evaluation/`,
   `evidence/`, `scope/`), no cinco módulos que se importan entre sí. Cada módulo expone solo su `index.ts`.
2. **Capas dentro de un módulo** solo donde hay reglas ricas (`audits/evaluation`, `library/templates`):
   ```
   domain/          TS puro: entidades, reglas, ciclos de vida. Sin Nest ni Prisma
   application/     use-cases + ports + mappers a DTO
   infrastructure/  adaptadores Prisma / Nextcloud
   presentation/    controllers + DTOs (Zod)
   ```
   En módulos simples (`organizations`, `identity`, `scales`) basta controller → use-case → Prisma, sin ports.
3. **Ports** solo para lo externo y para agregados con reglas: `FileStoragePort` (Nextcloud), `Clock`, y los
   repositorios de `Audit`, `Evaluation`, `Template`. Las lecturas (listados, dashboard, analytics) son
   *query services* con Prisma directo.
4. **Eventos de dominio en la misma transacción.** Un use-case hace `events.publish(new EvaluationApproved(...))`;
   un bus en memoria (~50 líneas) ejecuta los handlers **dentro de la transacción en curso** (CLS). Hoy hay un
   único handler: escribir en `audit_events`. Agregar notificaciones, feed global o webhooks después = un
   handler nuevo y, si hace falta, una tabla nueva; **los use-cases no se tocan**. Al ser síncrono y
   transaccional, no deja estados huérfanos (el problema que motivó abandonar `@nestjs/event-emitter`).
5. **API versionada desde el inicio** (`/api/v1`). Cambios de contrato = versión nueva.
6. **Migraciones aditivas** (expandir → migrar → contraer). Nada de renombrar columnas en un solo paso.
7. **Las capas se imponen con herramientas**, no con disciplina: `dependency-cruiser` falla el CI si `domain`
   importa Nest/Prisma, o si un módulo importa el interior de otro.

## 7. Plataforma

| Necesidad | Solución |
|-----------|----------|
| Config | Validación de env con Zod; falla al arrancar |
| Logging | `pino` directo (no `nestjs-pino`, que acopla el logger a HTTP): JSON, `redact` de secretos, `correlationId` vía CLS, pretty solo en dev. Ver `02` §13 |
| Errores | Errores de dominio con `code` estable + un filtro → `{ error: { code, message, details?, traceId } }` |
| Éxito | `{ data, meta? }`; solo DTOs de respuesta con mapper, nunca entidades |
| Validación / OpenAPI | Zod 4 con el soporte **nativo** de Nest 12 y `@nestjs/swagger` 12 (Standard Schema): un esquema da validación, tipos y documentación. Sin `nestjs-zod` (ver `02` §10) |
| Transacciones | `@nestjs-cls/transactional` + adaptador Prisma |
| Campos de auditoría | Prisma client extension (`createdById/updatedById`) |
| Autorización | CASL + test que recorre todas las rutas |
| Health | `@nestjs/terminus`: BD, Nextcloud, JWKS de Authentik |
| HTTP | `helmet`, `@nestjs/throttler`, CORS explícito |
| Observabilidad | Sentry |
| Etiquetas ES | `labels.es.ts` tipado `Record<Enum, string>` (exhaustivo en compilación); el API devuelve códigos |
| Calidad | TS `strict`, **ESLint** + typescript-eslint (reglas curadas), Prettier, `dependency-cruiser`, `knip`, Vitest + testcontainers, commitlint/husky, CI. Por qué ESLint y no Biome/oxlint: `02` §15 |

Sin Redis ni colas mientras los informes sean síncronos.

## 8. Mapa viejo → nuevo

| Antes | Ahora |
|-------|-------|
| `templates` (`code`,`version`,`publishedAt`,`archivedAt`) | `templates` (`name`,`status`) |
| `standards` | `controls` (`code` → `reference` libre y opcional; sin `level`, `isAuditable`, `guidance`) |
| `predefined_texts` | `suggested_findings` |
| `evaluation_frameworks` / `evaluation_levels` | `scales` / `scale_levels` |
| `audit_responses` + `audit_evaluations` | `evaluations` + `evaluation_reviews` |
| `audit_work_papers` | `evidences` |
| `audit_reports` | `reports` |
| `audit_activity` | `audit_events` |
| `global_feed`, `notifications` | (fuera; vuelven por §6.4) |
| — | `audit_scope_items` |

## 9. Fases

0. Este documento → `schema.prisma` → catálogo de errores → contrato OpenAPI base.
1. Esqueleto y plataforma (config, auth, CASL, transacciones, bus de eventos, errores, logging, CI, tests con
   Postgres real).
2. `identity` → `organizations` → `library` (scales, templates, controls, suggested_findings).
3. `audits`: lifecycle, scope, team, evaluation (ciclos de vida + scoring).
4. Evidencia y `reporting`.
5. `dashboard` y seeds.
