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
  - **Evidencia** si el nivel alcanzado es **superior al mínimo de la escala**: para decir que algo cumple hay que demostrarlo. El
    nivel mínimo («no cumple», «inexistente») **no exige evidencia**: ahí el hallazgo *es* la ausencia («se pidió y no existe»).
    «No aplica» exige motivo, no evidencia. La regla **no es configurable** (siempre se aplica). Borde: en una escala que
    empieza en 1 (sin cero), el nivel 1 cuenta como el mínimo.
- La **guía** (`guidance`) es un solo texto del líder por criterio: el contexto para el auditor y, a la vez, el porqué del nivel
  esperado. Sustituye a `expectedLevelReason`.
- Reasignar un criterio (líder) solo mientras no esté `COMPLETED` ni `APPROVED`.

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
| **3d** | Flujo del criterio (iniciar, editar, completar, aprobar, devolver, reabrir) con su historia |
| **3e** | `scoring.ts` (distribución por opción, promedios esperado/alcanzado, brecha) y lecturas: estadísticas, gráficas, brechas, historial |
| **3f** | Seguimientos (qué criterios incluir: pendiente de decidir, ver `05` §6) |

La **evidencia** (subir archivos, Nextcloud) y los **informes** son la Fase 4. La regla de evidencia de §3 se aplica contando los
registros de evidencia; hasta la Fase 4 no hay forma real de crearlos (las pruebas los insertan directamente).

## 8. Sin cambios respecto a lo ya acordado

Sin pesos ni puntajes guardados (`05` §6, §11); una sola escala por auditoría; «no aplica» es una marca de la evaluación con
motivo, no una opción de la escala; el nivel esperado es **por criterio**.
