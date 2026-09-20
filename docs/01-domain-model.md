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
| D8 | `frameworks`/`framework_levels` pasan a **`scales`/`scale_levels`** (escala de valoración: COBIT 5, CMMI, binaria, cualitativa). | "Framework" se confunde con la norma (ISO también lo es). Lo que son es una escala con niveles. |
| D9 | **Alcance**: catálogo `assets` por organización + `audits.scopeMode` + `audit_assets`. | Permite auditar "solo el ERP" de una organización y consultar el historial por activo. Ver §3. |
| D10 | **Se eliminan `global_feed` y `notifications`** del alcance inicial. Queda **`audit_events`**, el historial de cada auditoría. | Definir qué notificar y a quién es una decisión de producto que hoy no está tomada; las tablas solo agregan peso. El historial de auditoría sí se usa (19 puntos de escritura). Se agregan después vía §6. |
| D11 | Los eventos se guardan como **`type + payload`**, sin texto. El mensaje se genera al leer. | Congelar prosa en español impide cambiar redacción o idioma. |
| D12 | **Textos predefinidos → `suggested_findings`** (hallazgo sugerido por control y nivel). Solo existen filas con texto real. | Ver §4. |
| D13 | Se eliminan `guidanceOverride` (la guía por auditoría, sin uso) y `audits.description` (no aparece en informes). La guía vive solo en el control. | Solo entra lo que se usa. |
| D14 | Los valores derivables no se guardan: `achievedEvaluationLevel`, `expectedEvaluationLevel`, `WorkPaper.type`, `fileSizeFormatted`, `nextcloudFolderPath`, `level`, `actorName`. El `score` **sí** se guarda. | Menos columnas que puedan divergir. El `score` lo agregan los dashboards y queda congelado al cerrar. |

## 2. Modelo de datos objetivo

Todas las tablas llevan `id uuid` (UUIDv7, ordenable por tiempo), `createdAt` y `updatedAt` (`Timestamptz`),
salvo puentes y logs. Las **raíces de agregado** (`organizations`, `assets`, `scales`, `templates`,
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
- **assets**: `organizationId` FK, `name`, `type` (`APPLICATION | SYSTEM | INFRASTRUCTURE | PROCESS | FACILITY |
  DEPARTMENT | OTHER`), `description?`, `isActive`. UQ(`organizationId`, `name`).

### Biblioteca
- **scales**: `code` UQ, `name` UQ, `type` (`RANGE | BINARY | QUALITATIVE`, solo afecta al widget), `description?`,
  `isActive`.
- **scale_levels**: `scaleId` FK, `value Decimal(5,2)`, `label`, `shortName?`, `description`, `color`, `position`.
  UQ(`scaleId`, `value`).
- **templates**: `name` UQ, `description?`, `status` (`DRAFT | PUBLISHED | ARCHIVED`).
- **controls**: `templateId` FK (cascade), `parentId?` FK→controls (cascade), `code`, `title`, `description?`,
  `guidance?`, `position`. UQ(`templateId`, `code`). Índice (`templateId`, `parentId`, `position`).
  **FK compuesta** (`parentId`, `templateId`) → controls(`id`, `templateId`): la BD garantiza que el padre es de
  la misma plantilla.
  Se carga completo por plantilla (cientos de nodos) y el árbol se arma en memoria.
- **suggested_findings**: `controlId` FK (cascade), `levelId` FK→scale_levels, `text`. UQ(`controlId`, `levelId`).

### Auditorías
- **audits**: `code` UQ (secuencia de Postgres, sin `findByCode` + reintento), `name`, `introduction?`,
  `scopeNotes?`, `objectives?`, `templateId` FK, `organizationId` FK, `scaleId` FK, `managerId` FK→users,
  `parentAuditId?` FK→audits, `followUpNumber` (0 = inicial), `status` (`DRAFT|IN_PROGRESS|CLOSED|ARCHIVED`),
  `scopeMode` (`FULL_ORGANIZATION | SELECTED_ASSETS`), `plannedStart?`, `plannedEnd?`, `startedAt?`, `closedAt?`,
  `finalScore? Decimal` (snapshot al cerrar; en curso se calcula), `storageFolderId?` (la ruta se deriva del
  `code`), `version` (bloqueo optimista). Se eliminan `description`, `publishedAt`, `archivedAt`,
  `overallScore` mutable y `nextcloudFolderPath`.
- **audit_assets**: PK(`auditId`, `assetId`) + `organizationId` en ambas FK compuestas → la BD garantiza que el
  activo pertenece a la organización auditada.
- **audit_members**: `auditId`, `userId`, `role` (`LEAD_AUDITOR | INSPECTOR`), `notes?`.
  UQ(`auditId`, `userId`). Quitar un miembro es un borrado; queda en `audit_events`.
- **evaluations** (una por auditoría × control **hoja**): `auditId` FK, `controlId` FK, `weight Decimal(5,2)`,
  `expectedLevelId?` FK (nulo = máximo de la escala), `assignedUserId?` FK, `status`
  (`NOT_STARTED|IN_PROGRESS|COMPLETED|RETURNED|APPROVED`), `round` (desde 1), `achievedLevelId?` FK,
  `score? Decimal`, `findings?`, `notes?`, `isNotApplicable`, `notApplicableReason?`, `version`.
  UQ(`auditId`, `controlId`). Índices (`auditId`, `status`) y (`assignedUserId`, `status`).
  `score = achieved.value / expected.value × 100` (tope 100), calculado por el dominio en cada cambio.
  CHECK: `isNotApplicable` ⇒ `notApplicableReason` no nulo.
- **evaluation_reviews** (log append-only): `evaluationId` FK, `round`, `action`
  (`APPROVE|RETURN|REASSIGN|REOPEN|RESTORE`), `actorId` FK, `comments?`, `snapshot jsonb` (nivel, score,
  hallazgos, notas, N/A, ids de evidencia; tipado con Zod), `createdAt`. Restaurar una ronda lee el snapshot.
- **evidences** (antes `work_papers`): `evaluationId` FK, `round`, `title`, `description?`, `fileName`, `mimeType`,
  `size BigInt`, `storageFileId` UQ NOT NULL (fuente de verdad en Nextcloud), `deletedAt?` (único soft-delete del
  sistema: la evidencia eliminada debe seguir siendo trazable). Quién la subió: `createdById`.
  Ya no existen `source='legacy'`, `status`, `type`, `remotePath`, `uploadedBy`, `auditId` ni `standardId`.
- **reports**: `auditId` FK, `type`, `title`, `storageFileId`, `fileName`, `size`. Solo se guarda si la
  generación tuvo éxito (hoy se persisten también los FAILED con `errorMessage`).

### Historial
- **audit_events** (log append-only): `auditId` FK NOT NULL, `type`, `actorId?` FK, `targetUserId?` FK,
  `subjectType`, `subjectId`, `payload jsonb` (Zod discriminado por `type`), `createdAt`.
  Índices (`auditId`, `createdAt`) y (`subjectType`, `subjectId`).

### 2.1 Integridad que garantiza la BD (verificada contra Postgres 17)

| Regla | Mecanismo |
|-------|-----------|
| El activo del alcance pertenece a la organización auditada | FK compuestas en `audit_assets` (ambas comparten `organizationId`) |
| El padre de un control es de la misma plantilla | FK compuesta en `controls` |
| No se borra una organización / plantilla / escala / activo / control en uso | FK `onDelete: Restrict` (la cascada plantilla → controles también se bloquea si hay evaluaciones) |
| Una evaluación por control y auditoría; un miembro por auditoría | UNIQUE |
| N/A exige motivo; peso y score en 0–100; `round ≥ 1` | CHECK en `evaluations` |
| Seguimiento coherente: `parentAuditId` nulo ⇔ `followUpNumber = 0`; no es su propio padre; fechas ordenadas | CHECK en `audits` |
| `email` y `username` en minúsculas | CHECK en `users` |
| Color hexadecimal de nivel; `payload` y `snapshot` son objetos JSON | CHECK |
| Código de auditoría correlativo sin carreras | Secuencia `audit_code_seq` |

Lo que **no** se puede expresar en la BD y queda como regla de dominio: pesos que suman 100 por auditoría; el
nivel elegido pertenece a la escala de la auditoría; "al menos un activo" cuando `scopeMode = SELECTED_ASSETS`;
solo se evalúan hojas.

## 3. Alcance de la auditoría (D9)

- `organizations` = el auditado; puede tener N auditorías.
- `assets` = catálogo reutilizable de lo auditable dentro de esa organización (un sistema, un proceso, una
  sede…). Se crea una vez y se reutiliza.
- `scopeMode = FULL_ORGANIZATION` → sin filas en `audit_assets`. `SELECTED_ASSETS` → al menos un activo (regla
  de dominio) de la misma organización (regla de BD).
- `scopeNotes` sigue siendo texto libre para el redactado del informe.
- Consulta resultante: "todas las auditorías donde se evaluó el activo X".

**Fuera de alcance a propósito:** evaluar un mismo control por separado para cada activo dentro de una misma
auditoría. Añade una dimensión a `evaluations` y a los pesos. Si se necesita, una auditoría por activo.

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

Fórmulas de scoring y gap analysis; reglas de transición de auditoría y evaluación (ahora como tabla tipada `defineLifecycle`, sin XState; ver `03`); regla de pesos = 100
(reparto inicial uniforme con `createMany`; hoy son N+1 inserts); clonado de plantillas; CASL con su test de
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
| Logging | `nestjs-pino`: JSON, `redact` de secretos, `requestId` vía CLS, pretty solo en dev |
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
| Calidad | TS `strict`, ESLint type-checked, `no-explicit-any` en error, `dependency-cruiser`, `knip`, Vitest + testcontainers, commitlint/husky |

Sin Redis ni colas mientras los informes sean síncronos.

## 8. Mapa viejo → nuevo

| Antes | Ahora |
|-------|-------|
| `templates` (`code`,`version`,`publishedAt`,`archivedAt`) | `templates` (`name`,`status`) |
| `standards` | `controls` (sin `level`, sin `isAuditable`) |
| `predefined_texts` | `suggested_findings` |
| `evaluation_frameworks` / `evaluation_levels` | `scales` / `scale_levels` |
| `audit_responses` + `audit_evaluations` | `evaluations` + `evaluation_reviews` |
| `audit_work_papers` | `evidences` |
| `audit_reports` | `reports` |
| `audit_activity` | `audit_events` |
| `global_feed`, `notifications` | (fuera; vuelven por §6.4) |
| — | `assets`, `audit_assets` |

## 9. Fases

0. Este documento → `schema.prisma` → catálogo de errores → contrato OpenAPI base.
1. Esqueleto y plataforma (config, auth, CASL, transacciones, bus de eventos, errores, logging, CI, tests con
   Postgres real).
2. `identity` → `organizations/assets` → `library` (scales, templates, controls, suggested_findings).
3. `audits`: lifecycle, scope, team, evaluation (ciclos de vida + scoring).
4. Evidencia y `reporting`.
5. `dashboard` y seeds.
