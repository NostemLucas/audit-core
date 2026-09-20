# Audit Core — Arquitectura y reglas (borrador v1)

Complementa `01-domain-model.md`. Objetivo: que cada cosa se defina **en un solo lugar**, que las reglas de
cada módulo sean explícitas, y que agregar funcionalidad tenga una receta corta y predecible.

## 1. Principio rector

> **Cada hecho del sistema tiene una única fuente. Todo lo demás se deriva de ella o falla en compilación,
> en un test o en el CI.**

Si al agregar un campo, una regla o un permiso hay que editar 3 o más archivos "parecidos", el diseño está mal.
Este documento define la fuente de cada cosa (§3) y cómo se impone (§7).

## 2. Estructura

```
src/
  platform/        infraestructura transversal, SIN lógica de negocio
    config/ auth/ authz/ db/ errors/ events/ http/ logging/ storage/ health/
  shared/          tipos puros compartidos: enums.ts, labels.es.ts, limits.ts
  modules/
    identity/  organizations/  library/  audits/  reporting/  dashboard/
prisma/
  schema.prisma    ← fuente de la forma de los datos
  migrations/
```

Cada módulo expone **solo** su `index.ts` (API pública). Nadie importa archivos internos de otro módulo.

### Grafo de dependencias (sin ciclos, impuesto por CI)

```
platform, shared            → (nada del proyecto)
identity, organizations,
library                     → platform, shared
audits                      → + identity, organizations, library   (solo por su index.ts)
reporting                   → + audits
dashboard                   → lectura de todo (Tier C)
```

`reporting` y `dashboard` no los importa nadie.

**Integridad referencial la garantiza la BD, no otro módulo.** "No se puede eliminar una organización con
auditorías" o "una plantilla en uso" se resuelve con FK `onDelete: Restrict`; un único traductor de errores de
Prisma convierte `P2003` en el código de error del catálogo. Así `organizations` y `library` no dependen de
`audits`.

## 3. Única fuente de verdad

| Hecho | Única fuente | Se deriva / se valida contra |
|-------|--------------|------------------------------|
| Tablas, columnas, relaciones, **enums** | `prisma/schema.prisma` | Tipos de Prisma; `shared/enums.ts` solo los reexporta |
| Longitud y formato de campos de texto | `shared/limits.ts` (columnas `String` sin `VarChar`) | Esquemas Zod, OpenAPI |
| Contrato HTTP (entrada y salida) | `<recurso>.schemas.ts` (Zod) | Validación, serialización de respuesta, tipos TS, OpenAPI |
| Ciclo de vida (estados, transiciones, capacidades) | `*.lifecycle.ts` con `defineLifecycle` — ver [`03-state-standard.md`](./03-state-standard.md) | `allowedActions` del API, validación en use-cases |
| Permisos globales por rol | `platform/authz/abilities.ts` (CASL) | Guard, `packRules` para el frontend, test de rutas |
| Permisos contextuales (membresía en la auditoría) | `audits/domain/audit-policy.ts` | Use-cases, `allowedActions` |
| Fórmulas (score, peso, brecha) | `audits/domain/scoring.ts` | Use-cases, dashboard, informes |
| Errores | `errors.ts` de cada módulo (registrados en un catálogo) | Filtro HTTP, OpenAPI, tests |
| Eventos y su payload | `events.ts` del módulo (Zod) | `audit_events.payload`, mensajes |
| Textos en español | `shared/labels.es.ts`, `<modulo>/messages.es.ts` | Informes, mensajes de eventos |
| Rutas de Nextcloud | `audits/domain/storage-paths.ts` | Provisioning, evidencias, informes |
| Variables de entorno | `platform/config/env.ts` | Todo el proyecto |
| Paginación, orden, búsqueda | `platform/http/list-query.ts` | Todos los listados |
| Campos que nunca llegan a un log | `platform/logging/redaction.ts` | Logger (todas las líneas) |
| Traducción de errores de la BD | `onUnique` / `onForeignKeyDelete` en cada definición de error + `platform/db/translate-db-error.ts` (una extensión de Prisma la aplica a toda operación) | Casos de uso y filtro HTTP: reciben ya un `DomainError` |

Consecuencias concretas:

- **El frontend no reimplementa reglas.** Consume `abilities` (reglas CASL empaquetadas) y, por recurso,
  `allowedActions: ['submit', 'approve', …]` calculado con el ciclo de vida + la policy. Si cambia una
  regla, se cambia en un lugar.
- **Las longitudes solo viven en Zod.** Las columnas de texto son `text` (en Postgres `varchar(n)` no aporta
  rendimiento). No hay que sincronizar `@db.VarChar(200)` con `@MaxLength(200)` con constantes de entidad.
- **La salida se valida con el mismo esquema que la documenta.** El serializador nativo de Nest 12
  (`StandardSchemaSerializerInterceptor`) hace `schema.parse(resultado)`: recorta campos no declarados (adiós fugas de `createdBy`) y garantiza que la
  respuesta real coincide con el OpenAPI.
- **`if (x.status === …)` solo existe dentro del `*.lifecycle.ts`.** El resto pregunta `lifecycle.can(...)` / `lifecycle.has(...)`.
- **La score global se calcula solo en TypeScript** (`scoring.ts`). El SQL nunca reimplementa la fórmula; los
  dashboards usan `audits.finalScore` (cerradas) o llaman a `scoring.ts` (en curso).

### Errores: una definición lo dice todo

```ts
ORGANIZATION_IN_USE: {
  http: 409,
  message: 'La organización tiene auditorías; desactívala en lugar de eliminarla',
  onForeignKeyDelete: 'audits_organizationId_fkey',
}
```

Esa entrada es la única fuente del código, el HTTP, el mensaje **y** la traducción del error de la BD. Reglas
descubiertas al probar contra Postgres:

- `onForeignKeyDelete` solo aplica a **borrados**. Un fallo de FK al insertar significa "referencia inválida"; lo
  valida el dominio con un error específico y, si se le escapa, sale `REFERENCE_INVALID`. La misma FK puede fallar
  por causas distintas según la operación.
- Postgres informa **la primera FK que falla**, no la más relevante: si varias tablas referencian a una entidad, cuál
  aparece en el error depende del orden interno. Por eso un error puede agrupar varias restricciones
  (`onForeignKeyDelete` acepta una lista) y un test comprueba cada caso.
- Un test compara cada nombre de restricción referenciado contra la migración: si se renombra una columna y no
  el error, el CI falla (verificado con una mutación).

## 4. Tres tiers de módulo (cada módulo declara el suyo)

| Tier | Cuándo | Módulos | Estructura permitida |
|------|--------|---------|----------------------|
| **A · Dominio** | Reglas de negocio ricas, invariantes, ciclos de vida | `audits`, `library/templates` | `domain/` + `application/` + `infrastructure/` + `presentation/` |
| **B · CRUD** | Sin reglas más allá de validar y guardar | `identity`, `organizations`, `library/scales`, `audits/scope`, `audits/team`, `audits/evidence` | `controller` → `use-case` → `PrismaService`. Sin ports ni repositorio |
| **C · Lectura** | Agregaciones, listados, informes; nunca escribe | `dashboard`, `reporting`, listados de `audits` | *query services* con Prisma directo. Sin dominio |

Reglas por tier:

**Tier A**
- `domain/` es TypeScript puro: entidades, ciclos de vida, `scoring`, `policy`, eventos, errores. No importa Nest ni
  Prisma (salvo los enums vía `shared/enums.ts`). No hace I/O.
- Los *ports* (interfaces) se declaran en `application/ports/`; los adaptadores viven en `infrastructure/`.
- Solo hay port para: repositorios de agregados (`Audit`, `Evaluation`, `Template`), `FileStoragePort`, `Clock`.
- Un único **mapper** por agregado (`toDomain` / `toPersistence`) en `infrastructure/`. Es el único punto de
  traducción entre fila y dominio.

**Tier B**
- Sin repositorio ni port: el use-case llama a Prisma directamente. Siempre hay use-case, aunque sea corto,
  porque ahí viven la transacción, el evento y la comprobación de permisos; el controller nunca toca Prisma.
- Los esquemas de entrada se **derivan** del esquema base (`.pick`, `.partial`, `.omit`), no se reescriben.

**Tier C**
- Solo lectura. Puede unir tablas de varios módulos con Prisma/SQL (es el único tier con esa licencia).
- No contiene reglas de negocio: si necesita una fórmula, llama a `scoring.ts` vía `audits/index.ts`.

### Anatomía de `audits` (el módulo grande)

```
audits/
  domain/                 ← compartido dentro del módulo, puro
    audit.lifecycle.ts   evaluation.lifecycle.ts   scoring.ts   audit-policy.ts
    events.ts          errors.ts               storage-paths.ts
  infrastructure/         ← PrismaAuditRepository, PrismaEvaluationRepository, mappers, StorageAdapter
  lifecycle/  scope/  team/  evaluation/  evidence/     ← cortes verticales
     <corte>.controller.ts
     <corte>.schemas.ts
     use-cases/<verbo>-<sustantivo>.use-case.ts
  audits.module.ts   index.ts
```

Regla: **los cortes no se importan entre sí.** Lo que comparten está en `domain/` (puro) o `infrastructure/`. Esto
sustituye al `_shared/` actual (7.1k líneas de todo mezclado): aquí `domain/` solo admite código puro y sin I/O.

## 5. Anatomía de una operación (y cuántos archivos toca)

Una operación = 1 use-case + 1 método de controller + sus esquemas (en el `.schemas.ts` del recurso).

```ts
@Injectable()
export class ApproveEvaluationUseCase {
  @Transactional()
  async execute(actor: Actor, id: string, input: ApproveInput): Promise<EvaluationView> {
    const evaluation = await this.evaluations.getOrFail(id)      // port (Tier A)
    this.policy.assert(actor, membership, 'approve', evaluation)  // audit-policy.ts
    evaluation.approve(actor, input.comments)                     // dominio: usa el ciclo de vida
    await this.evaluations.save(evaluation)
    await this.events.publish(new EvaluationApproved({ ... }))    // bus: escribe audit_events
    return toView(evaluation)
  }
}
```

Convenciones fijas:
- `execute(actor, …)`. El actor se pasa **explícito**; el dominio nunca lee CLS. CLS solo lo usan la extensión
  de Prisma (`createdById/updatedById`) y el logger (`correlationId`).
- Toda operación que escribe lleva `@Transactional()`. Los eventos se publican dentro de la transacción.
- Los errores se lanzan como `new DomainError('EVALUATION_NOT_EDITABLE', { … })`. No hay una clase por error,
  ni `HttpException` en dominio.
- Identificadores en inglés; el español solo en `labels.es.ts` y `messages.es.ts`.
- Archivos de ~300 líneas como techo (lint `max-lines`). Un servicio de 900 líneas indica que mezcla
  responsabilidades.

## 6. Recetas: qué se toca al agregar cada cosa

| Quiero agregar… | Archivos | Detalle |
|-----------------|----------|---------|
| **Un campo a un recurso simple (Tier B)** | **2** | `schema.prisma` (+ migración generada) y el esquema base en `<recurso>.schemas.ts`. Los esquemas de crear/editar/respuesta se derivan. |
| **Un campo a un agregado (Tier A)** | 4 | `schema.prisma`, `schemas.ts`, entidad de dominio y mapper. Es el costo de tener dominio; el mapper es el único punto de traducción. |
| **Un endpoint** | 3 | use-case, método en el controller, esquemas. El permiso se declara en el decorador `@Can('accion', 'Sujeto')` del método. |
| **Un permiso nuevo** | 1–2 | `abilities.ts`; si es contextual, `audit-policy.ts`. El test de rutas falla si un endpoint no declara permiso. |
| **Un error** | 1 | `errors.ts` del módulo: `{ code, http, message }`. Filtro y OpenAPI lo toman del catálogo. |
| **Un evento** | 2 | `events.ts` (tipo + esquema del payload) y `messages.es.ts` (texto). TypeScript exige el mensaje: el mapa es exhaustivo. Publicarlo en el use-case. |
| **Una notificación (a futuro)** | 1 handler + 1 tabla | Un handler suscrito al bus. No se toca ningún use-case. |
| **Un estado o transición** | 1 (+ enum si es estado nuevo) | El `.lifecycle.ts`. `allowedActions`, validaciones y el frontend se derivan. Receta completa en `03` §5. |
| **Un enum nuevo o valor** | 1–2 | `schema.prisma`; `labels.es.ts` falla en compilación hasta que se traduzca. |
| **Una regla de cálculo** | 1 | `scoring.ts` (+ su test). |
| **Un módulo nuevo** | — | Elegir tier (§4), copiar su plantilla, declarar dependencias permitidas en `.dependency-cruiser.cjs`. |

## 7. Cómo se impone (no depende de disciplina)

| Regla | Mecanismo |
|-------|-----------|
| `domain/` no importa Nest ni Prisma (salvo enums) | `dependency-cruiser` en CI |
| Un módulo solo importa el `index.ts` de otro; sin ciclos; respeta el grafo de §2 | `dependency-cruiser` |
| `status ===` fuera de `*.lifecycle.ts` | ESLint `no-restricted-syntax` sobre comparaciones con `.status` |
| Prohibido `process.env` fuera de `config/env.ts` | ESLint `no-restricted-properties` |
| El cliente generado de Prisma (`src/generated/prisma`) solo lo importan `platform/db`, `infrastructure/` y `shared/enums.ts` | `dependency-cruiser` |
| Prohibido `any`, `@ts-ignore` sin motivo | TS `strict` + ESLint type-checked |
| Toda ruta declara `@Public`, `@Can` o `@NoAbilityRequired` | Test que recorre las rutas registradas |
| Códigos de error únicos y todos en el catálogo | Test sobre el registro |
| Mapas `Record<Enum, …>` completos | Compilación |
| El contrato HTTP no rompe sin querer | Test *snapshot* del OpenAPI (un cambio debe ser deliberado) |
| Código sin usar, exportaciones huérfanas | `knip` en CI |
| Archivos > 300 líneas | ESLint `max-lines` |
| Transacción + eventos correctos | Tests de integración con Postgres real (testcontainers) |

### Estrategia de pruebas

- **Dominio** (ciclos de vida, scoring, policy): unitarias puras, sin BD, muy rápidas. Aquí está la mayor cobertura.
- **Use-cases**: integración con Postgres real; incluye las condiciones de carrera (`Promise.all`) donde importen.
- **Contrato**: rutas ↔ permisos, catálogo de errores, snapshot OpenAPI, arquitectura.
- Sin mocks de Prisma: se prueba contra la base real o no se prueba el acceso a datos.

## 8. Extensibilidad: cómo crece sin romper

- **Eventos de dominio síncronos dentro de la transacción** (`platform/events`): hoy un handler escribe
  `audit_events`. Notificaciones, feed global, webhooks o métricas son handlers nuevos; los use-cases no cambian.
- **API versionada** (`/api/v1`); un cambio incompatible es una versión nueva, no una edición.
- **Migraciones aditivas** (expandir → migrar → contraer); nada de renombrar columnas en un solo paso.
- **Puertos para lo externo**: si Nextcloud se cambia por S3, se reescribe un adaptador.
- **Sin colas ni Redis** mientras los informes sean síncronos; si se necesitan, entran detrás de un port
  (`ReportQueuePort`) sin tocar los use-cases.

## 9. Definición de terminado (checklist de PR)

- [ ] Cada dato nuevo tiene **una** fuente (§3); nada se copia a mano en otro archivo.
- [ ] Endpoint con permiso declarado y esquema de respuesta.
- [ ] Errores en el catálogo, no como strings sueltos.
- [ ] Escrituras en `@Transactional()`; evento publicado si hay algo que historiar.
- [ ] Prueba de dominio para la regla y de integración para la operación.
- [ ] `lint`, `dependency-cruiser`, `knip`, tests y snapshot OpenAPI en verde.

## 10. Runtime y herramientas (decidido en la Fase 1b, con evidencia)

| Pieza | Decisión | Por qué |
|-------|----------|---------|
| Framework | **NestJS 12** (`12.0.3`), Express | Última estable. Es **ESM nativo** (`"type": "module"`). Express por ecosistema y por ser lo que asume la documentación de Nest; el rendimiento no es el cuello de botella de este sistema. |
| Módulos | **ESM**: `"type": "module"`, `module`/`moduleResolution: nodenext`, imports relativos **con extensión `.js`** (carpetas como `./x/index.js`) | Es la plantilla oficial de Nest 12 (`nest new`). Con ESM, `tsc` no rescribe imports: Node exige la extensión. |
| Compilador | `nest build` (tsc) + **TypeScript 6** | `tsc` emite los metadatos de decoradores que necesita la inyección de dependencias. Un transpilador sin ellos (esbuild/`tsx`) rompería el DI: por eso el arranque real se comprueba sobre el JS compilado, no solo en Vitest. |
| Tests | **Vitest 4**, sin plugin SWC | Funciona con decoradores según la plantilla oficial; verificado con un e2e que arranca la app real. |
| Cliente Prisma | Generador `prisma-client` (emite TypeScript dentro del proyecto) | Al compilar con el resto, no hay diferencia de formato. Nota: Prisma 7.10 también admite `moduleFormat = "cjs"`; no hace falta. |
| Zod | Zod 4 + **soporte nativo de Nest 12** (Standard Schema). **Sin `nestjs-zod`** | Ver el recuadro de abajo. |
| Alias de rutas | No; imports relativos | Con ESM el compilador no los rescribe y evita depender de plugins de resolución. La frontera entre módulos la impone `dependency-cruiser`, no la ruta. |

Rutas: negocio bajo `/api/v1/...`; `GET /health/live` fuera del prefijo y de la versión, y exento de rate limit.

### Formato de respuesta (implementado en `platform/http`)

```jsonc
// éxito                      // lista paginada                                   // error
{ "data": { … } }             { "data": [ … ], "meta": { "page", "pageSize",     { "error": { "code": "…", "message": "…",
                                "total", "totalPages" } }                             "details"?: …, "traceId": "…" } }
```

`traceId` = `x-request-id` (el entrante si es válido, o uno generado); vuelve también en la cabecera. Un error
desconocido responde `INTERNAL` (500) **sin** mensaje ni stack; se registra en el servidor con su `traceId`.

### Zod: por qué no `nestjs-zod` (verificado el 2026-09-20)

- `nestjs-zod@5.5.0` (25-jul-2026) declara peers `@nestjs/common ^10 || ^11` y `@nestjs/swagger ≤ 11`. Nest 12 salió
  a fines de agosto; en su repositorio hay un issue abierto (#471) y dos PR abiertos: uno que solo amplía los peers
  (#472, con un error de sintaxis semver) y uno que migra el repo a Nest 12 (#478, del 19-sep). Sin release.
- No hace falta esperarlo: **Nest 12 trae soporte nativo de Standard Schema**, que Zod 4 implementa.
  Cubre las tres piezas que iba a escribir a mano:

| Pieza | Nativo de Nest 12 | Lo nuestro |
|-------|-------------------|------------|
| Validar entrada | `StandardSchemaValidationPipe` + `@Body({ schema })`, `@Query({ schema })`, `@Param('id', { schema })` | `createValidationPipe()`: fallos → `VALIDATION_FAILED` con `details.issues[{ path, message }]` |
| Serializar salida | `StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })` | `ApiSerializerInterceptor`: solo añade que un `Page` se serializa ítem por ítem y conserva `meta` |
| OpenAPI | `@nestjs/swagger` 12 lee los esquemas de `@Body/@Query/@Param` y `~standard.jsonSchema` de Zod 4 | `@Responds(schema, { kind })`: declara la salida **una vez** (serializa + documenta el envelope `{ data }` / `{ data, meta }`); Swagger no lee `@SerializeOptions` |

Total propio: ~60 líneas en `platform/http`. Verificado con 10 tests (validación de body/query/param, recorte de
campos, array, `Page`, respuesta que viola su esquema → 500 sin filtrar detalle, y OpenAPI generado) y con el
build compilado corriendo en Node real.

## 11. Base de datos, transacciones y pruebas (Fase 1d, verificado contra Postgres real)

**Cliente.** `createDb()` = `PrismaClient` con el adaptador `@prisma/adapter-pg` + dos extensiones: **sellos**
(`createdById`/`updatedById`) y **traducción de errores**. El cliente generado vive en `src/generated/prisma`
(carpeta neutral, fuera de git; `postinstall` lo genera) y solo lo importan `platform/db`, `infrastructure/` y
`shared/enums.ts`. Conecta de forma perezosa: la app arranca aunque la BD no responda; `GET /health/ready` (503) lo
informa y `/health/live` no depende de la BD.

**Cómo escribe un caso de uso:**
```ts
constructor(@InjectTx() private readonly tx: Tx) {}

@Transactional()                          // solo en los métodos que escriben
async execute(actor: Actor, input: Input) {
  await this.tx.organization.create({ data: input })   // transaccional si hay transacción; normal si no
}
```
`@Transactional()` (de `@nestjs-cls/transactional`) sustituye al `TransactionDiscoveryService` con monkey-patching del
proyecto viejo. Probado: confirma, revierte todo si el método lanza, un método transaccional dentro de otro se une a
la externa, y sin la anotación no hay rollback (autocommit).

**Errores de la BD — lo que se comprobó al provocarlos (Prisma 7.10 + `pg`):**
- El **nombre exacto de la restricción llega** en `meta.driverAdapterError.cause.constraint.index`, tanto para UNIQUE
  (`P2002`) como para FK (`P2003`). Por eso el catálogo puede declararlas por nombre.
- `P2003` no dice si fue al insertar o al borrar: se decide por la **operación** (`delete`/`deleteMany`), no por el
  texto del mensaje (depende del idioma del servidor). Borrar → error "en uso"; escribir → `REFERENCE_INVALID`.
- Un CHECK llega como `P2039` con SQLSTATE `23514` en `cause`; el nombre de la restricción solo está en el mensaje.
  Se traduce a `INTEGRITY_VIOLATION` (422), sin exponer nombre ni datos de la fila.
- Un error dentro de `$transaction` se propaga y hace rollback; la carrera de dos transacciones con el mismo nombre
  deja una ganadora y la otra recibe el error del catálogo (probado con `Promise.allSettled`).
- `details` nunca lleva la restricción ni datos de la fila; el error original queda en `cause` (solo log).

**Sellos: límite conocido.** Solo se sella la operación de nivel superior; una escritura anidada
(`audit.update({ data: { reports: { create: … } } })`) **no** sella al hijo. Está fijado en un test. Regla:
las raíces de agregado se crean con su propia llamada.

**Guardas del catálogo (CI):** todo nombre de restricción referenciado existe en la migración; y **todo UNIQUE de la
migración tiene un error asignado o una excepción justificada por escrito** (`UNMAPPED_UNIQUES`). Agregar un UNIQUE
sin decidir qué le pasa al usuario rompe el build. `shared/enums.ts` tiene un test que exige reexportar todos los
enums del schema.

**Pruebas.** `npm test` (rápidas, sin BD) y `npm run test:integration` (Postgres 17 real en contenedor con
testcontainers, migraciones reales, en serie). Toda regla de esta sección tiene al menos una mutación verificada:
si se rompe el código, el test falla.

## 12. Eventos de dominio (Fase 1i, verificado contra Postgres real)

**Qué es.** `platform/events`: un bus **síncrono que corre dentro de la transacción** del caso de uso. Es el punto de
extensión previsto en §8: hoy no tiene suscriptores de negocio; el registrador de `audit_events` llega con el módulo
`audits` (Fase 3), y notificaciones, feed o webhooks serán handlers nuevos sin tocar ningún caso de uso.

**Cómo se usa.**
```ts
// modules/audits/domain/events.ts   ← única definición del evento
export const AuditEvents = defineEvents({
  AuditStarted: z.object({ auditId: z.uuid() }),
})
// modules/audits/messages.es.ts     ← su texto; sin él no compila
defineMessages(AuditEvents, { AuditStarted: (p) => `Inició la auditoría` })

// caso de uso
@Transactional()
async execute(...) { …; await this.events.publish(AuditEvents.AuditStarted, { auditId }) }

// handler (en su propio módulo)
onModuleInit() { this.bus.on(AuditEvents.AuditStarted, (e) => this.tx.auditEvent.create(…)) }
```

**Reglas.**
1. `publish` valida el payload contra su esquema **antes** de llamar a ningún handler; un payload inválido es un bug
   de quien publica y falla ahí (no aparece años después en el historial).
2. Los handlers corren **en orden y esperados**. Si uno falla, el error sube al publicador y **toda** la transacción
   se revierte; si el caso de uso falla después, lo que escribieron los handlers se revierte con él. Nunca queda un
   historial de algo que no ocurrió (por eso no se usa `@nestjs/event-emitter`).
3. Los handlers son rápidos y solo escriben en la BD (con `@InjectTx()`). El trabajo externo (Nextcloud, email) va
   **después del commit**, no en un handler.
4. Un handler no publica un evento que lo dispare a sí mismo (no hay guarda de profundidad: sería falsa seguridad).
5. El evento lleva `actorId` y `correlationId` del contexto ambiental; sin contexto (seeds, jobs) van vacíos.
6. Nombre en PascalCase y participio (`AuditStarted`); único en todo el sistema (`defineEvents` lo exige).
7. El texto se genera **al leer** (`renderEventMessage(type, payload)`): una fila de un evento que ya no existe, o
   con un payload que ya no cumple el esquema, devuelve `undefined` en vez de romper el historial.

**Guardas (CI).** Un mapa de mensajes incompleto no compila; `test/events-catalog.spec.ts` exige que todo evento
registrado en `app-events.ts` tenga mensaje y nombre único.

**Lo que se comprobó al probarlo.**
- Mutaciones verificadas: si el bus no esperase a los handlers, si se tragase sus errores, o si los ejecutase fuera de
  la transacción, los tests fallan.
- **Trampa de `nestjs-cls`:** `cls.run(fn)` **hereda** el contexto padre por defecto, así que ejecutar un handler dentro
  de un `cls.run` anidado *sigue* dentro de la transacción. Para salirse de ella hace falta
  `cls.run({ ifNested: 'override' }, …)`. Una mutación con el `run` por defecto no rompía nada; con `override` sí.
  Quien modifique el bus debe probar con la segunda forma.

## 13. Logging (Fase 1j): un contexto propio, separado de HTTP

**El error que se evita.** El logger del proyecto anterior era un solo servicio de 258 líneas que importaba `Request` y
`Response` de Express, tenía `logHttpRequest`, `logDatabaseQuery` y `logException`, y leía el payload del JWT desde
`req.user`. El logger de aplicación conocía HTTP, autenticación y base de datos. Y el interceptor solo registraba las
respuestas exitosas: no veía un 404 ni un rechazo antes del handler. Aquí son cuatro cosas distintas:

| Qué | Dónde | Sabe de | No sabe de |
|-----|-------|---------|------------|
| **Contexto ambiental** (`correlationId`, `userId`) | `platform/context` | CLS | HTTP |
| **Logger de aplicación** (`AppLogger`, `Log`) | `platform/logging` | `pino` y el contexto ambiental | HTTP, Nest (salvo su adaptador), negocio |
| **Log de acceso** (una línea por petición) | `platform/http/access-log.ts` | HTTP; usa el logger | — |
| **Historial de negocio** (`audit_events`) | módulo `audits` | negocio | logs |

La dependencia va en un solo sentido: `http → logging → context`. Lo impone `test/architecture.spec.ts` (y después
`dependency-cruiser`): `platform/logging`, `context`, `events` y `db` no pueden importar Express ni `platform/http`;
`domain/` no puede importar el logger.

**`correlationId`, no `requestId`.** Fuera de HTTP no hay petición. El id que enlaza logs, eventos y errores lo fija el
**punto de entrada**: en HTTP, `configureApp` monta el middleware que copia el `x-request-id`; en un job o un seed, el
`ContextRunner` abre un contexto nuevo con `<entrada>:<uuid>`. Ese puente (HTTP → contexto) es lo único que vincula a
ambos, y vive en `platform/http`. El logger solo *lee* `correlationId` y `userId`, sin saber de dónde vinieron.

**Cómo se escribe un log.**
```ts
private readonly log = this.logger.for('AuditService')   // AppLogger inyectado

this.log.info('Auditoría iniciada', { auditId })             // mensaje FIJO; lo variable, en campos
this.log.error('Falló la generación', { err, auditId })      // un error va en `err`
```
1. El **mensaje es texto fijo**. Los datos van en campos: se pueden buscar y la redacción de secretos actúa sobre ellos
   (no puede censurar un secreto pegado dentro del texto).
2. `correlationId` y `userId` se agregan **solos**; no se pasan a mano.
3. **`err`** se serializa con una **lista blanca** (tipo, mensaje, stack, `code`/`details` de un `DomainError`, y la
   cadena de `cause`, máx. 5). Nunca se vuelcan otras propiedades: un error de Prisma trae en `meta` la fila que falló.
4. **Redacción** (`redaction.ts`, única lista): `password`, `token`, `authorization`, `cookie`, `clientSecret`, `jwt`…
   a uno y dos niveles, incluidas las cabeceras.

**Log de acceso.** Middleware (no interceptor) que escribe una línea al cerrarse la respuesta, así ve también un 404,
un cuerpo rechazado antes del handler o una conexión cortada (`aborted`). Campos: método, ruta, patrón de ruta,
estado, duración, bytes, `correlationId`, `userId` si ya hay usuario. **No** registra cabeceras, cuerpo ni query string.
Nivel por estado: 2xx/3xx `info`, 4xx `warn`, 5xx `error`. Omite `/health/*`.

**Quién registra qué en un error.** El filtro registra los fallos **nuestros** (≥ 500) con su `err` completo; un error
de negocio (4xx) es un resultado esperado: solo `debug`, y el log de acceso ya deja constancia. Una respuesta 500
lleva el `traceId`; el detalle solo está en el log.

**Configuración.** `LOG_LEVEL` (por defecto `silent` en test, `info` en el resto) y `LOG_PRETTY` (por defecto solo en
desarrollo; `pino-pretty` es dependencia de desarrollo, así que en producción es JSON a stdout). Los logs internos de
Nest salen por el mismo canal (`bufferLogs` + `useLogger`).

**Por qué `pino` directo y no `nestjs-pino`.** `nestjs-pino` está construido alrededor de `pino-http`: su logger nace
ligado a la petición. Es cómodo, pero es el mismo acoplamiento que se quería evitar. Con `pino` directo son ~150
líneas propias y el logger funciona igual en un job que en una petición.

**Lo que NO es un log.** El historial de negocio (`audit_events`) no se deriva de los logs ni al revés: uno es un
registro de auditoría consultable por el usuario, el otro es telemetría técnica que se rota y se descarta.

**Fuera de esta fase (a propósito).** Registro de consultas lentas de Prisma y métricas: son de la base de datos, no de
HTTP ni del logger; entran como su propio componente cuando haga falta.

**Verificado.** 7 mutaciones sobre las garantías (el logger importa HTTP, lista de secretos vacía, sin leer el
contexto, el filtro registra 4xx como error, query string en el acceso, serializador sin lista blanca, sin middleware
de contexto) hacen fallar los tests. Dos de mis primeras mutaciones eran sintácticamente inválidas (el total de tests
bajó): una mutación que no compila no prueba nada, por eso el resumen incluye siempre el conteo de archivos.
Ejecución real del build en Node en JSON y en modo legible, sin secretos en la salida.

