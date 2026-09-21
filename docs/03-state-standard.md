# Audit Core — Estándar de estados (v1)

Norma para **todo** lo que "tiene un estado" en el sistema, hoy y a futuro. Cuando aparezca una entidad
nueva con estado, se clasifica con §1 y se aplica la sección que corresponda. Complementa
`01-domain-model.md` y `02-architecture.md`.

## 1. Cuatro clases de "estado" (y solo cuatro)

| Clase | Pregunta que responde | Cómo se modela | Hoy |
|-------|-----------------------|----------------|-----|
| **Ciclo de vida** | ¿En qué etapa de un proceso está y qué puede pasar después? | Enum de Prisma + `defineLifecycle` (§2) | `Template`, `Audit`, `Evaluation` |
| **Disponibilidad** | ¿Se puede elegir para usos **nuevos**? | `isActive Boolean` (§3) | `Organization`, `Scale` |
| **Derivado** | ¿Se deduce de otros datos? | **No se guarda.** Se calcula al leer | "vencida" (`plannedEnd` < hoy y `IN_PROGRESS`), "pendiente de revisión", "alcance completo" |
| **Externo** | ¿Lo decide otro sistema? | **No se modela** (§4) | Activación de cuentas → Authentik |

Cómo decidir, en orden:
1. ¿Lo decide un sistema externo? → Externo. No hay columna ni error propio.
2. ¿Se puede calcular con otras columnas? → Derivado. No hay columna. (Si el cálculo es caro, se cachea con una
   regla explícita; nunca es la fuente.)
3. ¿Solo importa si se puede seleccionar para cosas nuevas, y el pasado no cambia? → Disponibilidad.
4. ¿Tiene etapas con transiciones y reglas distintas en cada una? → Ciclo de vida.

Un hecho ortogonal al ciclo de vida **no entra en el enum**: es un campo aparte con su propia restricción.
Ejemplo: `Evaluation.isNotApplicable` (+ `notApplicableReason`, con CHECK en la BD) puede darse en cualquier etapa;
mezclarlo con `EvaluationStatus` duplicaría los estados (`IN_PROGRESS_NA`, `COMPLETED_NA`…).

## 2. Ciclo de vida

### 2.1 Cómo se nombra
- **Estados** = participio o adjetivo, `UPPER_SNAKE`: `DRAFT`, `PUBLISHED`, `IN_PROGRESS`, `CLOSED`, `RETURNED`.
  Describen cómo está la cosa, no lo que se hace.
- **Eventos** = verbo en infinitivo: `PUBLISH`, `START`, `CLOSE`, `ARCHIVE`, `COMPLETE`, `APPROVE`, `RETURN`,
  `REOPEN`. Son lo que alguien hace.
- **Etiquetas de capacidad** (*tags*) = adjetivo en minúscula: `editable`, `usable`, `evaluable`. Dicen qué se
  puede hacer **en** ese estado.
- **Eventos de dominio** (lo que se historia) = participio: `AuditStarted`, `EvaluationApproved`.

### 2.2 Dónde vive: un archivo por entidad
`domain/<entidad>.lifecycle.ts`, con `defineLifecycle` (`platform/state`). Es la **única** definición de:
qué estados hay, qué eventos mueven de uno a otro y qué capacidades tiene cada estado.

```ts
export const templateLifecycle = defineLifecycle<TemplateStatus, TemplateEvent, TemplateTag>({
  entity: 'TEMPLATE',
  invalidState: LibraryErrors.TEMPLATE_INVALID_STATE,
  states: {                                    // Record<TemplateStatus, …>: si falta un estado, no compila
    DRAFT:     { on: { PUBLISH: 'PUBLISHED' }, tags: ['editable'] },
    PUBLISHED: { on: { ARCHIVE: 'ARCHIVED' },  tags: ['usable'] },
    ARCHIVED:  { on: {},                       tags: [] },
  },
})
```

API (pura, sin efectos, sin I/O):

| Método | Devuelve |
|--------|----------|
| `can(status, event)` | `boolean` |
| `next(status, event)` | el estado destino, o lanza `DomainError(invalidState, { from, event })` |
| `allowed(status)` | eventos posibles desde ese estado |
| `has(status, tag)` | si el estado tiene esa capacidad |
| `assert(status, tag, error)` | lanza `error` si el estado no tiene la capacidad |
| `toMermaid()` | el diagrama, para documentación |

**Sin XState.** Estos ciclos son grafos lineales sin estados anidados, paralelos ni temporizadores; una tabla
tipada da exhaustividad **en compilación** (con XState hacía falta un test) y no arrastra una dependencia.
Si algún día un ciclo necesita más, se reemplaza la implementación de `defineLifecycle` sin tocar a quien la
usa (la API de la tabla es la misma).

### 2.3 Reglas del ciclo de vida
1. **El grafo y las capacidades se definen solo en el `.lifecycle.ts`.** Prohibido `if (x.status === …)` fuera de
   ese archivo (lint). Se pregunta `lifecycle.can(...)` / `lifecycle.has(...)`. Los nombres de estado no se
   copian a otra tabla (`statusToState`) ni a `meta` con flags que dupliquen getters.
2. **Los estados son exactamente los valores del enum de Prisma.** Sin mapeos ni nombres alternativos.
3. **Sin *guards* en el ciclo.** La máquina solo dice qué transiciones existen. Las **precondiciones**
   ("la plantilla tiene controles", "todas las evaluaciones están aprobadas") viven en el método de la entidad
   o en el caso de uso y fallan con **su propio error 422**, que explica el motivo. Un guard que falla solo
   podría decir "estado inválido", y eso oculta la causa.
4. **Orden dentro de un método de entidad:** (1) `to = lifecycle.next(...)`, para que un estado inválido gane a
   cualquier otro error; (2) precondiciones; (3) asignar estado y efectos (fechas, `round`, etc.).
   ```ts
   publish(): void {
     const to = templateLifecycle.next(this.status, 'PUBLISH')
     if (this.controlCount === 0) throw new DomainError(LibraryErrors.TEMPLATE_EMPTY)
     this.status = to
   }
   ```
5. **Los efectos de una transición los hace el método de la entidad**, no el grafo: poner `closedAt`, sumar
   `round`, etc. Así hay un solo lugar por efecto y el grafo sigue siendo un dato.
6. **Ningún estado se guarda por duplicado.** No hay una columna por etapa (`publishedAt`, `archivedAt`). Se
   guarda una fecha **solo si el negocio usa esa fecha** (informes, plazos): `Audit.closedAt`. `startedAt` no se guarda: solo lo escribía la máquina y nadie lo leía. El
   hecho de que "ocurrió una transición" queda en el historial (regla 8), no en columnas.
7. **Errores**, siempre de este molde (todo en el catálogo, ver `02` §3):
   | Situación | Código | HTTP |
   |-----------|--------|------|
   | El grafo no permite el evento desde el estado actual | `<ENTIDAD>_INVALID_STATE` con `details: { from, event }` | 409 |
   | Falta una capacidad (`editable`, …) | `<ENTIDAD>_NOT_<CAPACIDAD>`, p. ej. `AUDIT_NOT_EDITABLE` | 409 |
   | Falla una precondición | un código específico (`TEMPLATE_EMPTY`, `AUDIT_HAS_NO_MEMBERS`) | 422 |
8. **Historial:** toda transición de `Audit` y `Evaluation` publica un evento de dominio (`AuditStarted`…) dentro
   de la misma transacción; el handler lo escribe en `audit_events` (y en `evaluation_reviews` cuando hay una
   decisión de revisión). `Template` no publica evento hoy (no hay consumidor); agregarlo después es un handler.
9. **Concurrencia, sin bloqueos de fila.** El sistema NO usa bloqueos pesimistas (`SELECT … FOR UPDATE`). Lo que la BD puede
   garantizar (nombres únicos, FK, CHECK, el padre de un control es de la misma plantilla) lo garantiza ella; lo demás es un
   riesgo asumido y corregible (dos personas cambiando lo mismo en el mismo instante). La biblioteca (escalas, plantillas) no
   bloquea nada. Donde dos personas sí pueden chocar de verdad y el daño sería pisar el trabajo de otra (`Audit`, `Evaluation`),
   la entidad lleva `version` (**bloqueo optimista**) y toda transición es `@Transactional()`. Un choque sale como
   `PlatformErrors.VERSION_CONFLICT`: el segundo recibe «otra persona lo modificó, vuelve a cargar».
10. **Dependencia entre agregados:** si actuar sobre un hijo exige un estado del padre (editar una evaluación
    exige auditoría `IN_PROGRESS`), el caso de uso carga el padre y afirma **su** capacidad primero. Cada
    agregado responde por su propio estado; no se copia el estado del padre al hijo.
11. **Efectos externos** (Nextcloud) se ejecutan **después** de persistir, a través de un *port*, y deben ser
    idempotentes y reintentables. Si fallan, la transición ya guardada no se revierte; el caso de uso decide si
    reintenta o reporta `UPSTREAM_UNAVAILABLE`.
12. **Lectura (API):** todo recurso con ciclo de vida devuelve `status` y `allowedActions`.
    `allowedActions = lifecycle.allowed(status) ∩ lo que permite la policy del actor`. Es **estructural**: no
    incluye precondiciones (eso costaría consultas en cada lectura); si fallan, la ejecución responde 422 con el
    motivo. El frontend no reimplementa reglas: pinta botones desde `allowedActions`.

### 2.4 Especificación de los tres ciclos de vida

Contrato de diseño. Al implementar cada `.lifecycle.ts`, un test compara el grafo real con esta tabla.

**Template**
| Desde | Evento | Hacia | Efectos / precondiciones |
|-------|--------|-------|--------------------------|
| `DRAFT` | `PUBLISH` | `PUBLISHED` | Precondiciones, en este orden: no está vacía (`TEMPLATE_EMPTY`) y todo dominio (primer nivel) tiene hijos (`TEMPLATE_INVALID_STRUCTURE`, con la lista de los que fallan). El ciclo de vida se comprueba antes |
| `PUBLISHED` | `ARCHIVE` | `ARCHIVED` | — |

Capacidades: `DRAFT` → `editable`; `PUBLISHED` → `usable` (se puede auditar con ella). `ARCHIVED` es final.
Borrar: solo `DRAFT` y sin uso (la FK lo garantiza). Corregir una publicada = clonar con otro nombre.

**Audit**
| Desde | Evento | Hacia | Efectos / precondiciones |
|-------|--------|-------|--------------------------|
| `DRAFT` | `START` | `IN_PROGRESS` | Precondición: al menos un miembro (`AUDIT_HAS_NO_MEMBERS`). Efecto: evento `AuditStarted` (el momento queda en el historial) |
| `IN_PROGRESS` | `CLOSE` | `CLOSED` | Precondición: todas las evaluaciones aprobadas (`AUDIT_HAS_PENDING_EVALUATIONS`). Efecto: `closedAt`. Los resultados no se guardan: se derivan (`05` §11) |
| `CLOSED` | `ARCHIVE` | `ARCHIVED` | — |

Capacidades: `DRAFT` → `editable`; `IN_PROGRESS` → `evaluable` (se evalúa y se adjunta evidencia).
`CLOSED` es el único estado desde el que se crea un seguimiento. `ARCHIVED` es final. Sin transiciones hacia atrás.

**Evaluation**
| Desde | Evento | Hacia | Efectos / precondiciones |
|-------|--------|-------|--------------------------|
| `NOT_STARTED` | `START` | `IN_PROGRESS` | — |
| `IN_PROGRESS` | `COMPLETE` | `COMPLETED` | Precondiciones: nivel alcanzado presente (o N/A con motivo); hallazgos si el nivel alcanzado es inferior al esperado (`EVALUATION_INCOMPLETE`) |
| `RETURNED` | `RESUME` | `IN_PROGRESS` | Corregir una evaluación devuelta |
| `RETURNED` | `COMPLETE` | `COMPLETED` | Igual que arriba |
| `COMPLETED` | `APPROVE` | `APPROVED` | Precondición: nivel alcanzado presente. Escribe `evaluation_reviews` |
| `COMPLETED` | `RETURN` | `RETURNED` | Abre nueva ronda (`round + 1`). Escribe `evaluation_reviews` |
| `APPROVED` | `REOPEN` | `RETURNED` | Excepcional, exige comentario. Abre nueva ronda. Escribe `evaluation_reviews` |

Capacidades: `IN_PROGRESS` y `RETURNED` → `editable`; `COMPLETED` → `awaitingReview`; `APPROVED` → `locked`.
Además exige que la auditoría esté `evaluable` (regla 10). Otras operaciones (`REASSIGN`, `RESTORE`) no cambian
de estado: son acciones con registro en `evaluation_reviews`, no transiciones.

## 3. Disponibilidad (`isActive`)

Para `Organization` y `Scale`.

- **Significado único:** "se puede elegir para usos **nuevos**". No afecta a nada ya existente: una auditoría
  vieja sigue mostrando su organización aunque esté inactiva.
- Booleano `isActive`, por defecto `true`. Se cambia con dos endpoints, `activate` y `deactivate`, que comparten un solo caso de uso (`isActive` es su único parámetro).
  Sin ciclo de vida, sin máquina, sin eventos.
- **Validación al crear una referencia nueva** (auditoría → organización, auditoría → escala):
  el caso de uso comprueba `isActive` y, si no, lanza `<ENTIDAD>_INACTIVE` (422): `ORGANIZATION_INACTIVE`,
  `SCALE_INACTIVE`.
- Los selectores del frontend piden solo los activos (`?active=true`); los listados de administración los
  muestran todos.
- **Desactivar es la alternativa a borrar** cuando hay referencias: la FK `Restrict` impide borrar y el error
  (`*_IN_USE`) lo sugiere.
- No se usa para nada más. Si algo necesita etapas, es un ciclo de vida (§2), no un booleano con muchos
  significados.

## 4. Estados externos: usuarios

El sistema **no** tiene "usuario activo/inactivo". Autenticación y activación de cuentas son de **Authentik**:
si alguien está deshabilitado allá, no obtiene token y la petición sale `TOKEN_INVALID` (401). No hay columna,
caso de uso ni error local.

Consecuencias que se asumen:
- La fila local de un usuario deshabilitado en Authentik permanece (historial, auditorías firmadas) y no se borra.
- Como la sincronización ocurre en el login, un usuario deshabilitado sigue apareciendo como asignable hasta que
  se decida qué hacer; si esto molesta, la solución futura es un job de sincronización, no un flag manual local.
- `roles` se sincroniza desde los grupos de Authentik y **no** es editable localmente. Proteger al último ADMIN
  (conservar el rol si Authentik lo quitara) es lógica de la sincronización, no un error para el usuario.

## 5. Cómo agregar…

| Quiero… | Pasos |
|---------|-------|
| **Un estado nuevo a un ciclo de vida** | 1) valor en el enum de `schema.prisma` + migración; 2) TypeScript no compila hasta agregarlo en `states` del `.lifecycle.ts`; 3) `labels.es.ts` no compila hasta traducirlo; 4) actualizar la tabla de §2.4. |
| **Una transición nueva** | Una línea en `on` del `.lifecycle.ts`; método en la entidad (regla 4); evento de dominio si es de `Audit`/`Evaluation`; test de la tabla. |
| **Una capacidad nueva** | Agregar el tag al tipo y a los estados que la tengan; usar `lifecycle.assert(...)` en los casos de uso. |
| **Una entidad nueva con estado** | Clasificarla con §1. Si es ciclo de vida: enum + `.lifecycle.ts` + errores `<ENTIDAD>_INVALID_STATE` / `_NOT_*` + `allowedActions` en su respuesta. |
| **Volver activable/desactivable algo** | Solo si cumple §3; agregar `isActive`, `activate`/`deactivate` y `<ENTIDAD>_INACTIVE`. |

## 6. Qué reemplaza esto del proyecto actual (evidencia)

| Hoy | Estándar |
|-----|----------|
| Auditoría con XState, evaluación con una tabla artesanal: **dos estilos** | Un solo `defineLifecycle` |
| En la evaluación, el grafo escrito **dos veces** en el mismo archivo (`transitions` y `allowedTransitionsMap`) | Una sola tabla `states` |
| Guards `canStart`, `canClose`… que solo repiten `status === X` | Sin guards; el grafo ya lo dice |
| `statusToState` / `stateToStatus` (tercera copia de los nombres) | Estados = valores del enum |
| `meta` con `isEditable`, `isActive`, `isFinal` duplicando getters de la entidad | Tags de capacidad, en un solo sitio |
| Evento `RESET` declarado y sin uso | Solo existen eventos con transición |
| La máquina muta la entidad y arma mensajes en español con `BadRequestException` | Grafo puro; error del catálogo; texto en `messages.es.ts` |
| Columnas `publishedAt`, `archivedAt` que nadie usa | Solo fechas que el negocio consume |
| `isActive` de usuario controlado localmente | Authentik decide |

## 7. Cómo se verifica

- **Compilación:** `states` es `Record<Enum, …>`: un estado faltante o sobrante no compila.
- **Test por ciclo de vida:** el grafo implementado es idéntico a la tabla de §2.4 (tabla de casos: cada par
  estado × evento → destino o rechazo); todo estado no final alcanza un estado final o es terminal por diseño.
- **Lint:** `status ===` / `!==` fuera de `*.lifecycle.ts` falla el CI (`02` §7).
- **Catálogo:** todo `*_INVALID_STATE`, `*_NOT_*` e `*_INACTIVE` existe y es único (test del catálogo).
