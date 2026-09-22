# Audit Core — Diseño del dashboard y los seeds (Fase 5)

Última fase: lo que alguien ve al entrar (no un dato nuevo, solo lectura) y los datos de ejemplo para trabajar contra
algo real. Complementa `02` §4 (Tier C, "lectura de todo") y §6 (fases).

## 1. Módulo `dashboard`

**Corrección sobre `01`/`02`:** el plan original tenía un módulo `reporting` separado. Los informes terminaron viviendo
en `audits/reports/` (Fase 4c): son de UNA auditoría, reutilizan su política de permisos (`audit-policy.ts`, acción
`report`) y su plantilla de datos (`scoring.ts`, `computeGapViews`) — un módulo aparte no habría añadido nada, solo
una frontera que cruzar. `dashboard` sí se queda como módulo propio: **agrega a través de MUCHAS auditorías**, que es
justo lo que un módulo de un solo agregado no puede hacer bien.

Dos lecturas, ambas Tier C (Prisma directo, sin `domain/`, nunca escriben):

- **`GET /dashboard/summary`** — un panorama de las auditorías que el actor puede ver (docs/06 §1: todas para ADMIN/
  GERENTE, las propias para un auditor — `visibleAuditsWhere`, ya la usa `ListAuditsUseCase`, sin duplicar esa regla
  una tercera vez): cuántas por estado, cuántos criterios esperan revisión, cuántas están vencidas o vencen pronto.
  **Sin actividad reciente entre auditorías**: `01` ya decidió que no hay `global_feed` (se sacó del proyecto
  anterior); un panel que la mostrara reintroduciría esa tabla por la puerta de atrás. La actividad de UNA auditoría
  ya está en `GET /audits/:id/history`.
- **`GET /dashboard/my-work`** — lo que el actor tiene pendiente, cruzando auditorías: criterios que le asignaron y
  no ha terminado (`toEvaluate`), los que le llegaron a revisar como líder (`toReview`), y sus auditorías como manager
  con algo pendiente (`managing`). Sin paginación (un tope fijo por lista, `LIMITS.dashboardItems`): es un resumen
  para decidir qué abrir, no un listado completo — el listado completo ya existe (`GET /audits`, `GET .../evaluations`
  con filtros).

**Vencimiento** = `plannedEnd` de la auditoría, IN_PROGRESS. `overdue` (ya pasó) y `upcoming` (dentro de 14 días,
constante en el use case: no hay lectura que la necesite configurable) son conteos en `summary` y también ordenan
`managing` en `my-work` (lo más urgente primero).

**Sin `Organization` en el panel**: un AUDITOR no tiene `read` global sobre `Organization` (`abilities.ts`); mezclar
sus conteos aquí abriría una pregunta de alcance que nadie pidió resolver. Quien administra organizaciones ya tiene
`GET /organizations`.

## 2. Seeds

Los seeds son datos de EJEMPLO, no fixtures de test (esos ya existen en `test/integration/support/`). Un script
idempotente (`prisma/seeds/`, corrido con `tsx`, no parte del build) que:

1. Organizaciones de ejemplo (2–3).
2. Usuarios: los seeds NO crean usuarios (`01` §0 y `identity`: la única fuente es el primer login vía Authentik,
   `AuthentikUserSyncService`-equivalente de esta fase 1k). Un seed que insertara un `User` directo dejaría un
   `authentikId` inventado, imposible de loguear de verdad. En su lugar, el seed deja la biblioteca y las
   organizaciones listas; el PRIMER usuario que entra por Authentik con rol GERENTE puede crear auditorías de una vez.
3. Biblioteca: dos escalas (una `CONFORMITY` tipo ISO 27001, una `MATURITY` tipo COBIT 5) y dos plantillas publicadas
   (un recorte real de ISO 27001 — los mismos dominios que usan los tests de integración — y uno de COBIT 5), cada una
   con `suggested_findings` en un par de criterios, para que la biblioteca no se vea vacía.
4. **Sin auditoría de ejemplo por defecto**: crearla exige un manager real (un `User` que solo existe tras loguearse).
   Se documenta como un paso manual opcional después del primer login, no un seed.

`npm run seed` (nuevo script). Vuelve a ejecutarse sin duplicar (`upsert` por nombre único, ya garantizado por los
índices de fase 2).

## 3. Cómo se construye

| Paso | Contenido |
|---|---|
| **5a** (hecho) | `dashboard/`: summary, my-work |
| **5b** | `prisma/seeds/`: organizaciones + biblioteca de ejemplo |
