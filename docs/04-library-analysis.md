# Audit Core — Análisis de la biblioteca de plantillas (propuesta)

Estado: **decidido** (ver §4); sin implementar todavía. Pregunta de origen: ¿el árbol recursivo de controles sirve para
normas de formatos distintos y para los informes, o es una abstracción que no se ajusta? El `code` es arbitrario;
lo que importa de verdad son el nombre, la descripción y sobre todo los **criterios/actividades de evaluación**.

## 1. Qué hay hoy (evidencia del proyecto anterior)

Plantillas sembradas (subconjuntos de demostración, no las normas completas):

| | ISO 27001:2013 (Anexo A) | ASFI |
|---|---|---|
| Nodos | 24 | 30 |
| Por nivel | 6 / 6 / 12 | 2 / 7 / 21 |
| Hojas evaluables | 12 (todas en el nivel 3) | 21 (todas en el nivel 3) |
| `isAuditable` ≠ "es hoja" | **0 discrepancias** | **0 discrepancias** |
| Hojas sin descripción | **0** | **0** |
| Formato del `code` | `A.5` → `A.5.1` → `A.5.1.1` | `1` → `1.1` → `1.1.1` |

Lo que contiene una hoja evaluable: el **título** es solo el nombre del control y la **descripción** es el criterio
real ("Se debe definir un conjunto de políticas… aprobado por la dirección, publicado y comunicado…"). En ASFI una
sola hoja llega a listar cinco aspectos a verificar en una línea. Los agrupadores llevan título y, a veces, el objetivo.

> **Aclaración posterior (corrige una conclusión de este análisis):** las plantillas sembradas eran de demostración. En las
> plantillas reales **la hoja evaluable no lleva descripción**: su **título es el criterio** ("existe control de backups"),
> y la descripción es solo el texto explicativo de la norma, que aparece sobre todo en los agrupadores. Por eso no se exige
> descripción en las hojas (ver §4.1, puntos 4 y 8).

Formato de importación (Excel): columnas `código`, `título`, `descripción`, `código padre`, `guía del auditor`. La
jerarquía se reconstruye con `código padre`, así que **el `code` es a la vez etiqueta visible, clave técnica del
archivo, criterio de orden y, como se ve abajo, criterio de agrupación**. Son cuatro trabajos para un dato arbitrario.

## 2. Lo que falla por depender del `code` (reproducido con la lógica exacta del proyecto anterior)

**Agrupación por dominio en los gráficos** (`r.code.startsWith(`${dominio.code}.`)`):

| Norma | Dominio → hoja | Hojas agrupadas |
|---|---|---|
| ISO 27001 (2013 y 2022) | `A.5` → `A.5.1.1` | 2 de 3 ✔ (excluye bien `A.6…`) |
| COBIT 5 | `APO` → `APO01.01` | **0 de 3 — dominio vacío** |
| COBIT 5 | `APO01` → `APO01.01` | 2 de 2 ✔ |
| NIST CSF | `PR` → `PR.AA-01` | 3 de 3 ✔ |
| ASFI (artículos) | `Art. 5` → `Art. 5 inc. a` | **0 de 2 — dominio vacío** |

Funciona solo si el código de cada hijo empieza textualmente por el del padre más un punto. Con otra convención el
gráfico sale vacío **sin ningún error**.

**Definición de "dominio" inconsistente.** El gráfico usa el nodo raíz del árbol; el análisis de brechas usa
`extractDomain`, que toma los dos primeros segmentos del código separado por puntos. Para `1.1.1` da `1.1` (que es el
nivel 2) y para `APO01.01` devuelve la propia hoja. Dos módulos con dos definiciones distintas de la misma palabra.

**Orden en el informe** (`a.code.localeCompare(b.code)`): `A.10.1.1  A.18.1.1  A.5.1.1  A.6.1.1  A.9.1.1`. El orden
numérico correcto es `A.5 → A.6 → A.9 → A.10 → A.18`. Es orden alfabético de texto.

Todo esto es la misma causa: **se usó una etiqueta de presentación como clave técnica**.

## 3. ¿Es el árbol recursivo la estructura adecuada?

Honestamente: **la estructura sí, la implementación actual no**. (La justificación real de la recursión es la profundidad variable; ver §4.2.)

Lo que la recursión resuelve y una estructura fija no:
- **Profundidad variable.** ISO 27001:2022 Anexo A son 2 niveles (tema → control); ISO 27001:2013 son 3; COBIT 5 son 4
  (dominio → proceso → práctica → actividad); un reglamento normativo puede tener libro → título → capítulo →
  sección → artículo → inciso. Un modelo de 3 niveles fijos obliga a deformar la norma.
- **Hojas a distintas profundidades** dentro de una misma norma (una cláusula con incisos junto a otra sin ellos).

Lo que aporta a los **informes**: un informe con la misma forma que la norma, sea cual sea su profundidad, y los subtotales
por **dominio** (el primer nivel) para las gráficas de araña. Se llegó a proponer también subtotales en cualquier nivel y
numeración automática por posición; ambas cosas se **descartaron** (§4.2): solo se mide el primer nivel y cada norma numera
a su manera.

Costos honestos de la recursión: mover y reordenar nodos es más delicado que en una lista, hay que impedir ciclos
(ya lo hace la FK compuesta y una regla de dominio) y conviene limitar la profundidad. La lectura no es un problema:
una norma completa son cientos o pocos miles de nodos, y se carga entera por plantilla y se arma en memoria.

## 4. Decisión (tras la discusión)

### 4.1 Lo que se decide

1. **La referencia es manual.** `code` pasa a **`reference`**: texto libre y **opcional** que se escribe tal cual lo usa la
   norma (`A.5.1`, `a)`, `APO01.01`, `Art. 5`, `II`…). Sin unicidad y **sin ninguna lógica encima**: ni para agrupar, ni
   para ordenar, ni como clave de importación. Se elimina `UNIQUE(templateId, code)` y `CONTROL_CODE_TAKEN`.
2. **El orden es explícito** (`position` entre hermanos). En algunas normas el orden sigue al del padre y en otras es
   arbitrario, así que no se puede deducir de ningún texto. Se reordena subiendo o bajando entre hermanos y la
   importación conserva el orden de las filas.
3. **Sin niveles definidos.** El árbol tiene la profundidad que cada rama necesite (de 2 a 4 niveles, y una rama puede ser
   más profunda que otra). No hay etiquetas ni prefijos por nivel.
4. **Lo que se evalúa y se pondera es el último nodo** (la hoja): el criterio/actividad, que es la pregunta ("¿la empresa
   tiene control de backups?"). **El criterio es el `title` de la hoja.** `description` (texto explicativo de la norma) y
   `guidance` (ayuda para el auditor) son opcionales en cualquier nodo. Un nodo con hijos es un agrupador y no se evalúa. Si una pregunta tuviera sub-preguntas,
   la pregunta original pasa a ser el primer hijo.
5. **Solo el primer nivel se mide.** Los nodos raíz son los "dominios" (en ISO 27001, `A.5`, `A.6`…) y sirven para las
   gráficas de araña y los subtotales del informe. Todo lo que hay debajo son criterios/actividades organizados para leer.
   No se calculan subtotales en niveles intermedios.
6. **La jerarquía sale del árbol, en un solo lugar.** Una función pura (`library/domain/control-tree.ts`) da, para cada
   hoja, su dominio (el nodo raíz) y su ruta. Reemplaza al `startsWith` de los gráficos y al `extractDomain` del análisis de
   brechas, que daban dominios vacíos o inconsistentes (§2).
7. **Importación con una columna `nivel`** y las filas en orden de lectura: el padre de una fila es la fila anterior de nivel
   menor. Es lo único que no depende de códigos, que aquí son arbitrarios. Se sigue aceptando `código padre` (archivos
   existentes) resolviéndolo solo dentro del archivo. La exportación escribe el mismo formato (ida y vuelta estable).
8. **Qué exige publicar** (`TEMPLATE_EMPTY` / `TEMPLATE_INVALID_STRUCTURE`, con la lista de nodos que fallan): la plantilla tiene
   al menos una hoja; todo nodo tiene título; y **todo nodo raíz tiene hijos** (un dominio es un agrupador). Una plantilla plana
   (un raíz que es a la vez criterio) no se publica: hay que agruparla, porque el dominio es siempre el primer nivel y de
   otro modo no existiría para ese criterio. **No se exige descripción** en ningún nodo.
9. **Para quien audita, el árbol es contexto.** El auditor trabaja con la lista plana de criterios (las hojas), cada uno con
   su ruta (dominio › objetivo) para no ser ambiguo entre dominios. El árbol se mantiene poco: la plantilla publicada es
   inmutable, se importa con la columna `nivel`, y se corrige subiendo o bajando elementos.

### 4.2 Lo que se propuso y se DESCARTÓ (para no reabrirlo)

- **Niveles definidos en la plantilla con etiqueta, prefijo, "inicia en" y estilo de numeración** (numérico, letras,
  romanos) y numeración automática por posición. Descartado por sobreingeniería: cada norma numera a su manera y algunas
  no siguen ninguna regla. Cualquier esquema automático dejaría fuera casos reales, y una excepción manual acabaría siendo
  la norma. Solo habría reproducido bien ISO 27001, que no es el problema.
- **Subtotales en cualquier nivel del árbol** como argumento a favor de la recursión: no se necesita. Solo se mide el
  primer nivel. La recursión se justifica por la **profundidad variable**, no por los subtotales.

### 4.3 Cómo quedan las decisiones abiertas

| | Respuesta |
|---|---|
| D-A. Qué se puntúa | **La hoja** (opción A). Actividad, criterio y control son lo mismo: la pregunta del nivel más bajo. |
| D-B. "Múltiples formatos" | **Estructuras de distinta profundidad** (2 a 4 niveles, ramas desiguales): cubierto por el árbol. No se pidió una escala distinta por sección. |
| D-C. Referencia | **Manual**, opcional, sin lógica encima. |
| D-D. Material real | Pendiente: las plantillas de ISO y ASFI reales servirían para probar la importación. |

Supuesto **confirmado**: el dominio es siempre el primer nivel. No existe una norma con un único nodo paraguas y, si la
hubiera, se separa (sus hijos pasan a ser el primer nivel). No hace falta una profundidad de gráfica por plantilla.

## 5. Qué cambia en el modelo

- `controls`: `code` → `reference` (nullable, sin `UNIQUE`); resto igual.
- Se elimina `CONTROL_CODE_TAKEN`; se agrega `TEMPLATE_INVALID_STRUCTURE` (422). `description` queda opcional (ya lo es).
- Nuevo `library/domain/control-tree.ts` (pura): dominio y ruta de cada hoja, con su suite de pruebas usando los códigos que
  hoy fallan (COBIT, NIST, ASFI, numeraciones sin puntos) y ramas de distinta profundidad.
- Importación/exportación por `nivel`, con ida y vuelta probada.
- Migración inicial regenerada (no hay BD desplegada).
