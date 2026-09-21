# Audit Core — Diseño de `audits` (Fase 3)

Reglas del módulo grande. Las de la columna «origen» salen del código del proyecto anterior (`audit-final2`), que es la
especificación de comportamiento; las marcadas **[nueva]** son decisiones de este diseño y se pueden discutir.
Complementa `01` (datos), `03` (estados) y `05` (cómo se puntúa).

## 1. Quién puede hacer qué

Hay dos capas: los permisos **globales** por rol de sistema (`platform/authz/abilities.ts`, decide si la ruta se puede llamar)
y los **contextuales** de esta auditoría (`audits/domain/audit-policy.ts`, función pura). El **manager** es el dueño de la
auditoría (quien la creó); el **líder** (`LEAD_AUDITOR`) y los **inspectores** (`INSPECTOR`) son miembros del equipo.

| Acción | Quién (además del ADMIN, que lo puede todo) | Origen |
|---|---|---|
| Crear una auditoría | Rol global GERENTE (queda como su manager) | vieja |
| Ver la auditoría, sus evaluaciones y su historial | GERENTE (global), su manager, sus miembros | vieja |
| Editar datos y alcance, eliminar el borrador, iniciar, cerrar, archivar, crear seguimiento | El **manager** | vieja |
| Designar o quitar al **líder** | El **manager** (puede designarse a sí mismo) | vieja (el ADMIN no podía: **[nueva]** sí) |
| Agregar o quitar **inspectores** | El **líder** | vieja |
| Fijar el nivel esperado de los criterios, asignar criterios a inspectores | El **líder** | vieja |
| Aprobar, devolver, reabrir o restaurar una evaluación | El **líder** | vieja |
| Evaluar (editar, completar) un criterio | El **inspector asignado a ese criterio** | vieja |

- **El líder revisa, no evalúa** (vieja): un criterio solo se le asigna a un inspector.
- Un miembro debe tener el rol global AUDITOR; la excepción es el manager, que puede ser su propio líder (vieja).
- **Solo hay un líder por auditoría** (vieja). El proyecto anterior lo aseguraba con un bloqueo de fila; aquí lo garantiza la
  BD con un **índice único parcial** (`audit_members(auditId) WHERE role = 'LEAD_AUDITOR'`) **[nueva]**, sin bloqueos.
- El equipo solo cambia con la auditoría en `DRAFT` o `IN_PROGRESS`, y no se quita a un miembro que tiene criterios asignados.

## 2. Ciclo de vida

Es el de `03` §2.4. Puntos concretos:

- **Las evaluaciones se crean con la auditoría** (una por hoja de la plantilla, sin nivel esperado), no al iniciarla, para
  poder fijar niveles esperados y asignar criterios mientras está en borrador (vieja: `initialize-responses` al crear).
- **La plantilla, la organización y la escala no se cambian** después de crear el borrador **[nueva]**: cambiarlas obligaría a
  regenerar las evaluaciones. Para otra combinación se elimina el borrador y se crea uno nuevo.
- **Iniciar** exige: al menos un miembro (`AUDIT_HAS_NO_MEMBERS`) y nivel esperado en **todas** las hojas
  (`AUDIT_EXPECTED_LEVELS_MISSING`, con cuántas faltan). *Pregunta abierta:* ¿exigir también un líder? Sin él nadie puede
  aprobar y la auditoría solo la cierra un ADMIN. Hoy se conserva el comportamiento anterior (basta un miembro).
- **Cerrar** exige todas las evaluaciones aprobadas, incluidas las «no aplica» (`AUDIT_HAS_PENDING_EVALUATIONS`).
- **Crear una auditoría** exige: plantilla **publicada**, escala **activa**, organización **activa** (`03` §3), y fechas
  coherentes (`plannedEnd >= plannedStart`, que ya comprueba la BD).
- El código `AUD-AAAA-NNNNN` sale de la secuencia `audit_code_seq`; el año, del reloj del sistema (`platform/clock`, inyectable).
- Los textos largos (`introduction`, `scopeNotes`, `objectives`) son **texto plano** **[nueva]**: el proyecto anterior los guardaba como HTML
  saneado; eso se decide con los informes (Fase 4) y no antes, porque exige un sanitizador.

## 3. Historial (`audit_events`)

Un solo registrador suscrito al bus de eventos (`platform/events`), dentro de la transacción del caso de uso. Cada evento de
auditoría lleva `auditId` y, opcionalmente, `targetUserId` (a quién afecta) y el id de lo que cambia (`evaluationId`,
`memberId`, `scopeItemId`): de ahí salen `subjectType` y `subjectId` por **convención** (`domain/events.ts`), para que agregar un
evento sea solo su esquema y su mensaje. El texto se genera al leer. Nada de notificaciones ni feed (`01` D10).

## 4. Cómo se construye (un commit y una etiqueta por paso)

| Paso | Contenido |
|---|---|
| 3a | Lectores públicos de `organizations` y `library` (el de `identity` llega con el equipo, que es cuando se usa); reloj; política, ciclo de vida, eventos y registrador; crear, ver, listar, editar y eliminar auditorías; alcance |
| 3b | Lector de usuarios (`identity`); equipo: designar líder, agregar y quitar inspectores; asignar criterios |
| 3c | Nivel esperado por criterio (uno a uno y masivo); iniciar, cerrar y archivar |
| 3d | Flujo de evaluación (iniciar, editar, completar, aprobar, devolver, reabrir, restaurar) y `evaluation_reviews` |
| 3e | `scoring.ts` (distribución por opción, promedios esperado/alcanzado, brecha) y lecturas: estadísticas, gráficas, análisis de brechas, historial |
| 3f | Seguimientos (qué criterios incluir: pendiente de decidir, ver `05` §6) |

Evidencia (Nextcloud) e informes son la Fase 4.

## 5. Cosas que NO cambian respecto al modelo ya acordado

Sin pesos ni puntajes guardados (`05` §6, §11); una sola escala por auditoría; «no aplica» es una marca de la evaluación con
motivo, no una opción de la escala; un solo nivel esperado **por criterio** (no uno base por auditoría).
