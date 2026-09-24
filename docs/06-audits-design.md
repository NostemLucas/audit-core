# Audit Core — Diseño de `audits` (Fase 3, versión 2)

Cómo funciona una auditoría. **Reemplaza a la primera versión**, que copiaba los roles del proyecto anterior (un ADMIN
que hacía de todo, un manager que solo creaba, un líder que armaba el equipo y aprobaba). Aquí las responsabilidades se
separan como en una auditoría real (ISO 19011: responsable de la función, auditor líder y equipo auditor). Complementa `01`
(datos), `03` (estados) y `05` (cómo se puntúa).

## 1. Roles

Hay **dos capas**, que no se mezclan.

**Roles globales** (vienen de Authentik, se pueden sumar: una persona puede ser ADMIN y GERENTE a la vez). Dicen qué se
puede hacer en el sistema (`platform/authz/abilities.ts`):

| Rol | Es |
|---|---|
| **ADMIN** | Administra la **plataforma**: usuarios, catálogos. **Ve** todo, pero **no actúa sobre el contenido de una auditoría** (no evalúa, no revisa, no cierra). Una sola excepción: **transferir** una auditoría a otro manager (p. ej. el manager dejó la organización), que queda en el historial |
| **GERENTE** | Dirige la función de auditoría. Crea auditorías y las gestiona como su **manager**; administra la biblioteca (plantillas, escalas, organizaciones). Ve todas las auditorías |
| **AUDITOR** | Puede ser asignado a un equipo |

Sin superusuario. Quien necesite poder hacerlo todo tiene los dos roles y actúa como el que corresponda, con su nombre en el
historial. (Una persona con dos roles globales se comporta como el que la acción exige; no hay «bypass».)

**Roles dentro de una auditoría** (los asigna el manager al armar el equipo). En el código: `LEAD` y `MEMBER`; en pantalla,
«Líder» y «Auditor».

| Rol | Qué hace |
|---|---|
| **Manager** (el GERENTE que la creó) | Responde por la auditoría: **arma el equipo** (líder y auditores), define el alcance, **inicia**, **cierra** y archiva. Crea seguimientos |
| **Líder** (`LEAD`) | Coordina y **revisa**. **Asigna** criterios a los auditores, fija el **nivel esperado** de cada criterio con su **guía**, sigue el avance y **revisa** lo que envían: aprueba, devuelve con comentario o reabre uno aprobado. **No evalúa criterios y no agrega ni quita miembros** |
| **Auditor** (`MEMBER`) | **Hace la auditoría**: evalúa los criterios que le asignaron, escribe hallazgos, adjunta evidencia y los envía a revisión. Solo edita lo que tiene asignado |

Reglas del equipo:
- **Quien revisa no revisa su propio trabajo**: por eso el líder no evalúa. Una auditoría necesita, como mínimo, un líder y un
  auditor. El manager puede designarse a sí mismo líder (útil en equipos pequeños).
- **Un solo líder por auditoría**, garantizado por la BD con un **índice único parcial** (`audit_members(auditId) WHERE role =
  'LEAD'`), sin bloqueos.
- Pueden ser miembros los usuarios con rol global AUDITOR o GERENTE.
- El equipo lo cambia **solo el manager**, con la auditoría en borrador o en curso. No se quita a un miembro que tiene criterios
  asignados (se reasignan antes). Cambiar de líder en curso es posible.
- Todos los miembros ven toda la auditoría; **editar** solo lo asignado.

Permisos contextuales (`audits/domain/audit-policy.ts`, función pura):

| Acción | Quién |
|---|---|
| Ver auditoría, criterios e historial | GERENTE (global), ADMIN (global), manager, miembros |
| Crear | GERENTE (queda como manager) |
| Editar datos y alcance, eliminar el borrador, iniciar, cerrar, archivar, seguimiento, **armar el equipo** | Manager |
| Transferir a otro manager | ADMIN |
| Asignar criterios, fijar nivel esperado y guía, **revisar** (aprobar, devolver, reabrir) | Líder |
| Evaluar y enviar a revisión un criterio | El auditor al que está asignado |

## 2. Ciclo de una auditoría

Es el de `03` §2.4. Puntos concretos:

- **Las evaluaciones se crean con la auditoría** (una por hoja de la plantilla), para poder asignar criterios mientras está en
  borrador. **El nivel esperado de cada una se fija según la dimensión de la escala elegida** (la dimensión es una propiedad de
  la ESCALA, no del estándar: quien crea la escala en la biblioteca decide a cuál de las dos se parece su comportamiento; un
  estándar nuevo —COBIT, SIM3, lo que sea— no exige tocar código, solo elegir la dimensión correcta al crear su escala):
  - **`CONFORMITY`**: se fija sola, al puntaje **más alto** de la escala, en el momento de crear la auditoría. El líder no hace
    nada. La norma no deja margen: se espera el cumplimiento total, sin un juicio que tomar criterio por criterio. El líder
    puede cambiarlo si hay una excepción real (un sistema legado que se acepta con menos), con su motivo (`guidance`), pero
    nunca queda vacío otra vez.
  - **`MATURITY`**: queda **vacío** al crear. El líder lo fija **criterio por criterio**, con su guía: el nivel exigido varía
    según qué tan crítico es cada proceso (un CSIRT nacional necesita más madurez en un parámetro que un equipo interno; un
    proceso central de COBIT pesa más que uno secundario). Es trabajo real del líder, uno por uno o en bloque.
- **La plantilla, la organización y la escala no se cambian** tras crear el borrador.
- **Iniciar** (manager) exige: un **líder** y al menos **un auditor**; **nivel esperado** en todas las hojas
  (`AUDIT_EXPECTED_LEVELS_MISSING` — en la práctica solo bloquea a las auditorías `MATURITY`: en `CONFORMITY` ya está resuelto
  desde la creación); y **todos los criterios asignados** (`AUDIT_UNASSIGNED_EVALUATIONS`).
- **Cerrar** (manager) exige todos los criterios **aprobados**, incluidos los «no aplica» (`AUDIT_HAS_PENDING_EVALUATIONS`).
- **Crear** exige plantilla **publicada**, escala **activa**, organización **activa** y fechas coherentes.
- El código `AUD-AAAA-NNNNN` sale de la secuencia `audit_code_seq`.
- Los textos largos de la auditoría son **texto plano**.

## 3. Ciclo de un criterio (evaluación)

```
NOT_STARTED ─▶ IN_PROGRESS ─▶ COMPLETED ─▶ APPROVED
                    ▲              │            │
                    │              ▼            │
                    └───────── RETURNED ◀───────┘   (devolver / reabrir, con comentario)
```

- **`COMPLETED` = enviado a revisión.** Mientras espera, y una vez aprobado, **no se edita**; solo se edita en `IN_PROGRESS` y
  `RETURNED`. Por eso lo que se envía es exactamente lo que se aprueba.
- **Devolver** y **reabrir uno aprobado** exigen comentario. **Aprobar** puede llevarlo.
- **Para enviar a revisión** (`COMPLETE`): nivel alcanzado (o «no aplica» con **motivo**) y, además:
  - **Hallazgo escrito** si el nivel alcanzado es inferior al esperado (`EVALUATION_INCOMPLETE`).
  - **Gravedad** (`severity`: `MAJOR`/`MINOR`/`OBSERVATION`) si el nivel alcanzado es inferior al esperado **y la escala es
    `CONFORMITY`** (`requiresSeverity`, `domain/evaluation-completion.ts`): en conformidad una mayor puede bloquear una
    certificación, así que tiene una consecuencia real; en `MATURITY` nunca es obligatoria (un perfil de madurez no se
    "clasifica" así). El campo está disponible en las dos dimensiones — puede anotarse aunque no se exija, y se limpia junto
    con el nivel alcanzado al marcar «no aplica» — pero solo se exige para completar en conformidad y por debajo de lo
    esperado.
  - **Evidencia** si el nivel alcanzado es **superior al mínimo de la escala**: para decir que algo cumple hay que demostrarlo. El
    nivel mínimo («no cumple», «inexistente») **no exige evidencia**: ahí el hallazgo *es* la ausencia («se pidió y no existe»).
    «No aplica» exige motivo, no evidencia. La regla **no es configurable** (siempre se aplica). Borde: en una escala que
    empieza en 1 (sin cero), el nivel 1 cuenta como el mínimo.
  - Orden de las faltantes: hallazgo → gravedad → evidencia.
- La **guía** (`guidance`) es un solo texto del líder por criterio: el contexto para el auditor y, a la vez, el porqué del nivel
  esperado. Sustituye a `expectedLevelReason`.
- Reasignar un criterio (líder) solo mientras no esté `COMPLETED` ni `APPROVED`.
- **Todas las acciones sobre un criterio** (editar, enviar, aprobar, devolver, reabrir) exigen la auditoría **en curso**
  (`AUDIT_NOT_EVALUABLE`): en una cerrada o archivada no se toca nada, tampoco reabrir.
- **No hay «iniciar» explícito**: la primera edición del auditor asignado arranca el criterio (`NOT_STARTED` → `IN_PROGRESS`,
  evento `EvaluationStarted`). Enviar (`COMPLETE`) sin haberlo editado es `EVALUATION_INVALID_STATE`; el ciclo de vida se
  comprueba **antes** que las precondiciones de contenido.
- **«No aplica» y nivel alcanzado son excluyentes**: marcar «no aplica» borra el nivel; poner un nivel con «no aplica»
  activo es `EVALUATION_IS_NOT_APPLICABLE` (hay que desmarcarlo de forma explícita, `isNotApplicable: false`).
- **Al aprobar**, el líder puede marcar `requiresFollowUp` (booleano, por defecto `false`): fuerza que ese criterio se
  vuelva a evaluar desde cero en el próximo seguimiento, aunque haya cumplido o no aplicara — es una anotación del líder
  ("esto pasó esta vez, pero hay que revisarlo de nuevo"), no un resultado. Efecto en `carriesOver` (`9`).

## 4. Historia de las revisiones

**Un solo mecanismo:** `audit_events`. No hay tabla de revisiones, ni rondas, ni «restaurar».

- **El estado vigente** de un criterio (enviado, en revisión, devuelto, aprobado) es su `status`: un campo, sin lógica extra.
- **La historia de un criterio** es la consulta de sus eventos (`subjectType = Evaluation`, `subjectId`), en orden:
  `EvaluationAssigned`, `EvaluationCompleted`, `EvaluationReturned` (con el comentario), `EvaluationApproved`,
  `EvaluationReopened` (con el comentario).
- **`EvaluationCompleted` lleva una copia del contenido en ese momento** (nivel alcanzado, hallazgos, notas, «no aplica» y su
  motivo, y las evidencias asociadas). Es lo que permite ver «cómo estaba cuando se envió» y comparar dos envíos para saber qué
  se corrigió tras una devolución. Solo se guarda **al enviar**: los borradores intermedios no se versionan (no hace falta: lo
  enviado y lo aprobado coinciden porque no se edita entre medias).
- La lectura tolera que una copia antigua tenga otro formato (muestra el comentario aunque no pueda mostrar el detalle).

## 5. Historial de la auditoría

Un solo registrador suscrito al bus de eventos, dentro de la transacción del caso de uso. Cada evento lleva `auditId` y,
si aplica, `targetUserId` y el id de lo que cambia (`evaluationId`, `memberId`, `scopeItemId`): de ahí salen `subjectType` y
`subjectId` por convención (`domain/events.ts`). El texto se genera al leer.

## 6. Qué cambia respecto al modelo anterior (`01`)

| Se elimina | Se agrega o cambia |
|---|---|
| Tabla `evaluation_reviews`, enum `ReviewAction`, `evaluations.round`, `evidences.round`, la operación «restaurar», `REVIEW_SNAPSHOT_NOT_FOUND`, el evento `RESUME` | `evaluations.expectedLevelReason` → `guidance`; rol de equipo `LEAD`/`MEMBER` (antes `LEAD_AUDITOR`/`INSPECTOR`); error `AUDIT_UNASSIGNED_EVALUATIONS`; error de evidencia faltante; permisos del ADMIN reducidos a lectura y transferencia |

## 7. Cómo se construye (un commit y una etiqueta por paso)

| Paso | Contenido |
|---|---|
| **3a** (hecho) | Auditorías (crear, ver, listar, editar, eliminar), alcance, historial, lectores públicos |
| **3b-0** (hecho) | Ajustes de este diseño sobre lo hecho: esquema (lo de §6), permisos del ADMIN, política de permisos |
| **3b** (hecho) | Equipo: lector de usuarios (`identity`), designar líder y auditores, transferir el manager; asignar criterios |
| **3c** (hecho) | Nivel esperado y guía por criterio (uno a uno y masivo); iniciar, cerrar y archivar |
| **3d** (hecho) | Flujo del criterio (iniciar al primer edit, editar, completar, aprobar, devolver, reabrir) con su historia |
| **3e** (hecho) | `scoring.ts` (conteos, distribución por opción, promedios esperado/alcanzado por dominio, brecha; **sin nota global**, `05` §6) y lecturas: `GET results`, `GET gaps`, `GET history` (de la auditoría) y `GET evaluations/:id/history` (de un criterio) |
| **3f** (hecho) | Seguimientos como auditoría normal con enlace a la anterior (§9) |
| **3g** (hecho) | Bloqueo optimista (`version`) en `PATCH /audits/:id` y `PATCH .../evaluations/:id` (§10) |
| **3h** (hecho) | Gravedad del hallazgo (`severity`, obligatoria solo en conformidad por debajo de lo esperado) y seguimiento forzado por el líder (`requiresFollowUp`, §3 y §9) |
| **3i** (hecho) | Conteo de hallazgos por gravedad en el informe (docs/07 §2) |
| **3j** (hecho) | `GET .../evaluations/:evaluationId/previous`: resultado anterior de un criterio en un seguimiento (§9) |
| **3k** (hecho) | Gráfico embebido en el informe: nivel esperado vs. alcanzado por dominio (docs/07 §2) |
| **3l** (hecho) | Catálogo de datos ampliado (`controls[]`, `results[]`) y plantilla de informe editable por tipo (`ReportTemplate`, docs/07 §2.1) |

La **evidencia** (subir archivos, Nextcloud) y los **informes** son la Fase 4. La regla de evidencia de §3 se aplica contando los
registros de evidencia; hasta la Fase 4 no hay forma real de crearlos (las pruebas los insertan directamente).

### Lecturas del 3e

| Endpoint | Devuelve |
|---|---|
| `GET /audits/:id/results` | Avance por estado del criterio; total con conteos y distribución; por dominio, conteos, distribución y los dos promedios con su brecha. Provisional mientras la auditoría está en curso (`progress.approved` dice cuánto está aprobado) |
| `GET /audits/:id/gaps` | Criterios evaluados por debajo de lo esperado, del más lejano al menos (a igual brecha, orden de lectura) |
| `GET /audits/:id/history` | Historial paginado, lo más reciente primero, con el texto redactado al leer |
| `GET /audits/:id/evaluations/:evaluationId/history` | Historia de un criterio en orden cronológico, con el contenido del evento (la copia de lo enviado) |
| `GET /audits/:id/evaluations/:evaluationId/previous` | Cómo quedó ESE control en la auditoría anterior (`fase-3j`, solo en un seguimiento; `null` si no aplica) — ver `9` |

Los ven todos los que ven la auditoría. Un evento que ya no existe o cuyo contenido no cumple el formato actual **no rompe** la
lectura: se muestra su tipo (§4).

## 8. Sin cambios respecto a lo ya acordado

Sin pesos ni puntajes guardados (`05` §6, §11); una sola escala por auditoría; «no aplica» es una marca de la evaluación con
motivo, no una opción de la escala; el nivel esperado es **por criterio**.

## 10. Bloqueo optimista (y la única excepción pesimista)

Editar datos de la auditoría (`PATCH /audits/:id`) y editar el contenido de un criterio (`PATCH /audits/:id/evaluations/:id`)
son los dos sitios donde dos personas pueden pisarse: dos ediciones a la vez, o una edición sobre algo que alguien ya cambió.
Sin bloqueos de fila (decisión de fase-2i): en su lugar, la columna `version` de `audits` y `evaluations`.

**Excepción, a propósito (fase-5l/5m):** las transiciones de estado de `Evaluation` (arrancar, enviar, aprobar, devolver,
reabrir) SÍ toman un bloqueo pesimista (`SELECT ... FOR UPDATE` sobre la fila de `Audit`, `loadAuditForUpdate` en
`audits/infrastructure/audit.queries.ts`), y `CloseAudit` también. No es optimista aquí porque `transitionEvaluation`
(el CAS de abajo) protege la fila de la EVALUACIÓN, pero cerrar depende de un invariante que cruza TODAS las evaluaciones
de la auditoría a la vez ("¿está aprobada CADA UNA en este instante?") — algo que un CAS de una sola fila no puede
expresar. Verificado con una prueba de concurrencia real: sin el candado, un `REOPEN` sobre un criterio aprobado se
colaba entre que `CloseAudit` contaba los pendientes y escribía, dejando la auditoría CERRADA con un criterio sin
aprobar. **Todas** las transiciones de evaluación toman el candado, no solo aprobar/reabrir: cualquiera de ellas
inserta en `audit_events`, cuya clave foránea ya pide un `FOR KEY SHARE` sobre esa misma fila — si no todas piden el
candado ANTES y en el mismo orden, dos transiciones concurrentes se deadlockean entre sí (confirmado con un deadlock
real de Postgres al agregarlo solo en algunas). El candado se libera solo al terminar la transacción; nunca queda
retenido más que una operación corta.

- **El cliente manda la versión que leyó** (`version` en el cuerpo, obligatorio en ambos PATCH). La escritura va con
  `WHERE id = ? AND version = ?`; si no tocó ninguna fila, alguien la cambió entre medias → `409 VERSION_CONFLICT` (con
  `details.expected`, la versión que se mandó). El cliente relee y decide si reintenta.
- **Toda escritura sube la versión**, la haga o no un PATCH: una asignación, un cambio de nivel esperado, aprobar, transferir,
  etc. Así "la fila cambió desde que la leíste" significa lo mismo sin importar qué caso de uso la tocó. Lo hace una extensión
  de Prisma (`platform/db/extensions.ts`, `versionExtension`), automática por columna, igual que los sellos de auditoría: no
  hay que acordarse de subirla a mano en cada `update`.
- **El primer edit de un criterio (arranca + guarda contenido) es una sola escritura**, así que sube la versión una sola vez.
- No se guarda ninguna otra cosa por esto: es un contador, no una instantánea.

## 9. Seguimientos

**Un seguimiento es una auditoría normal con un enlace a la anterior.** No hay entidad ni estado propios, ni se crean filas solo
para algunos criterios (eso complicaba el proyecto anterior): todo lo demás —equipo, evaluación, revisión, cierre, resultados,
historial— funciona igual. Decidido con el usuario, 2026-09-21.

- **Crear** (`POST /audits` con `previousAuditId`): la anterior debe estar **cerrada o archivada** (`followable`,
  `AUDIT_CANNOT_FOLLOW_UP`). Plantilla, escala y organización **se toman de la anterior** (no se indican: `400` si se
  mandan): es la misma medición, así que siguen valiendo aunque la plantilla se haya archivado o la escala desactivado después.
  La organización sí debe seguir activa. Puede haber varios seguimientos de la misma anterior.
- **`carryOver`** (por defecto `true`; solo con `previousAuditId`):
  - **`true`**: cada criterio que allí **cumplió** (alcanzado ≥ esperado) o **no aplicaba**, Y que el líder **no** marcó
    `requiresFollowUp` al aprobarlo, nace **`APPROVED`** con el resultado copiado (nivel, hallazgo, gravedad, notas, «no
    aplica» y su motivo) y `carriedFromId` apuntando al criterio de la anterior. El resto nace `NOT_STARTED`, limpio —
    incluye tanto lo que quedó por debajo como lo que cumplió pero el líder pidió revisar de nuevo (`carriesOver()`,
    `domain/follow-up.ts`: `requiresFollowUp` gana sobre cualquier otro resultado).
  - **`false`**: se evalúa todo de nuevo; la anterior queda como referencia.
- **Nivel esperado y guía**: todos los criterios los heredan de la anterior (el líder no parte de cero en madurez).
- **Sin estado nuevo:** trasladado = `APPROVED` + `carriedFromId`. Por eso **cerrar** funciona solo (ya está aprobado) y **iniciar
  no exige asignarlo** (no tiene a quién). Los resultados cuentan `carriedOver` (siguen contando como evaluados/cumplen; solo se
  cuentan aparte para no hacerlos pasar por verificados en esta auditoría). Su historia se pide en la auditoría anterior.
- **Re-evaluar uno trasladado** = el **reabrir** que ya existe (líder, con comentario): pasa a `RETURNED`, **deja de ser trasladado**
  (`carriedFromId` se borra), conserva su contenido y hay que asignarlo para trabajarlo. Al enviarlo, la regla de evidencia
  aplica como siempre: la evidencia de la anterior no se copia.
- **Alcance**: se copia el de la anterior. Si **se trasladan criterios**, no se puede indicar otro ni modificarlo
  (`AUDIT_SCOPE_INHERITED`): «cumple» valía para ese alcance (el alcance son nombres sueltos, no están ligados a criterios, así
  que no se puede saber cuáles siguen valiendo). Si el cliente pide A y B, se crea con `carryOver: false` (o sin nada que
  trasladar) y el alcance se indica o edita como en cualquier borrador.
- **En un seguimiento de un seguimiento**, `previousAuditId` es la anterior **inmediata**.
- **Ver el resultado anterior de un criterio** (`GET .../evaluations/:evaluationId/previous`, `fase-3j`): busca por
  `(previousAuditId, controlId)`, no por `carriedFromId` — funciona igual para lo trasladado que para lo re-evaluado
  desde cero (lo que quedó por debajo no tiene `carriedFromId`, pero el auditor igual quiere ver qué pasó antes).
  `null` si la auditoría no es un seguimiento. El acceso se valida contra ESTA auditoría (igual que `previousAudit` en
  `AuditView`): quien ve el seguimiento ve el resultado anterior de sus criterios, aunque no tenga acceso a la
  auditoría anterior en sí.
