# Audit Core — Análisis de la biblioteca de plantillas (propuesta)

Estado: **propuesta para decidir**, sin implementar. Pregunta de origen: ¿el árbol recursivo de controles sirve para
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

Honestamente: **la estructura sí, la implementación actual no**.

Lo que la recursión resuelve y una estructura fija no:
- **Profundidad variable.** ISO 27001:2022 Anexo A son 2 niveles (tema → control); ISO 27001:2013 son 3; COBIT 5 son 4
  (dominio → proceso → práctica → actividad); un reglamento normativo puede tener libro → título → capítulo →
  sección → artículo → inciso. Un modelo de 3 niveles fijos obliga a deformar la norma.
- **Hojas a distintas profundidades** dentro de una misma norma (una cláusula con incisos junto a otra sin ellos).

Lo que aporta a los **informes** (esto es lo que el proyecto anterior desperdiciaba, al agregar solo por el nivel 1):
- **Subtotales en cualquier nivel**: el puntaje de un agrupador es el de sus descendientes, y se puede mostrar el radar
  por dominio y bajar a "objetivo" o "capítulo" sin código nuevo.
- **Índice y numeración automáticos** (`1`, `1.2`, `1.2.3`) calculados por posición, sin depender del `code`.
- Un informe con la misma forma que la norma, sea cual sea su profundidad.

Costos honestos de la recursión: mover y reordenar nodos es más delicado que en una lista, hay que impedir ciclos
(ya lo hace la FK compuesta y una regla de dominio) y conviene limitar la profundidad. La lectura no es un problema:
una norma completa son cientos o pocos miles de nodos, y se carga entera por plantilla y se arma en memoria.

## 4. Propuesta

### 4.1 El `code` deja de ser identidad
- `code` → **`reference`**: texto **opcional**, **sin unicidad**, que se muestra tal cual ("A.5.1", "APO01.01", "Art. 5")
  y que **ninguna lógica usa**. Se elimina `UNIQUE(templateId, code)` y el error `CONTROL_CODE_TAKEN`.
- La identidad es el `id`. El orden es `position` entre hermanos.
- Lo que hoy se deduce del código pasa a deducirse **del árbol**, en un solo lugar (`library/domain/control-tree.ts`, una
  función pura probada) que devuelve por nodo: `depth`, `root` (el dominio), `path`, `number` posicional (`2.1.3`) y
  permite `rollup` de cualquier valor por subárbol. Gráficos, análisis de brechas, informes y exportación la usan; se
  eliminan `extractDomain` y el `startsWith`.

### 4.2 El criterio es lo primordial
- En una hoja, `description` **es el criterio de evaluación**; en un agrupador, el objetivo. Los datos lo respaldan
  (0 hojas sin descripción en 33 hojas). Regla nueva al **publicar**: toda hoja debe tener criterio
  (`TEMPLATE_INCOMPLETE`, con la lista de controles que faltan), además de "tiene al menos un control".
- La numeración del informe sale de la posición; la `reference` se imprime al lado, si existe.

### 4.3 Importación por niveles
Formato canónico: filas en orden de lectura con una columna `nivel` (1, 2, 3…); el padre de una fila es la fila anterior
de nivel menor. No hace falta ningún código ni que sean únicos, así que sirve para cualquier norma. Se sigue aceptando
`código padre` (archivos existentes) resolviéndolo **solo dentro del archivo**, como clave local de la importación, no
como restricción de la base. Validaciones: la primera fila es de nivel 1, sin saltos de más de un nivel, título
obligatorio. La exportación escribe el mismo formato, de modo que importar → exportar → importar es estable. Otros
formatos de origen (esquema en Markdown, JSON) serían adaptadores hacia el mismo árbol canónico; no se construyen hasta
que haya un caso real.

El Excel de hallazgos sugeridos hoy empareja por `code`; pasaría a llevar una columna `id` técnica (o emparejar por
posición del árbol), porque un `reference` opcional y repetible no sirve de clave.

## 5. Decisiones abiertas (necesito tu respuesta)

**D-A. Qué se puntúa.** Es la más importante y no puedo resolverla desde el código:
- **A (recomendada): se puntúa el control (la hoja).** Las actividades/criterios que lo componen viven en su
  descripción como lista (una línea por actividad) y el auditor las verifica mientras evalúa. Es lo habitual en una
  auditoría ISO 19011: los hallazgos se registran por requisito, no por cada viñeta.
- **B: se puntúa cada actividad.** Tablas nuevas `control_criteria` y `evaluation_criteria(resultado, nota)`; el nivel
  del control se deriva o se sugiere del porcentaje cumplido. Da hallazgos por actividad en el informe. Costo: con ~93
  controles de ISO 27001:2022 y ~5 actividades cada uno son ~450 resultados por auditoría, más pantallas y más peso en la
  repartición de pesos (que deben sumar 100).
- **C: cada actividad es una hoja de un árbol más profundo.** No agrega tablas, pero multiplica las evaluaciones y los
  pesos igual que B, sin distinguir "actividad" de "control".

**D-B. ¿Qué querías decir con "múltiples formatos"?** Lo puedo leer de tres maneras y cambia la solución:
1. normas con estructuras distintas (profundidad, nombres): cubierto por el árbol;
2. distintos **archivos** de origen (Excel, Word, PDF): cubierto por el importador canónico + adaptadores;
3. distintas **formas de evaluar según la sección** (p. ej. las cláusulas 4–10 de ISO 27001 se juzgan como
   cumple/no cumple y el Anexo A como madurez): hoy la escala es **una por auditoría**. Soportarlo exige una escala por
   agrupador. Es el cambio más grande y solo lo haría si lo necesitas.

**D-C.** ¿Renombrar `code` → `reference` (opcional, sin unicidad) y pasar a importación por `nivel`?

**D-D.** Si tienes el material real (los Excel o documentos de ISO y ASFI que usan), pásamelo: lo que hay sembrado son
24 y 30 nodos de demostración y no me permite validar las normas completas.

## 6. Qué cambiaría en el modelo si se aprueba (A + C + D-B.1/2)

- `controls`: `code` → `reference` (nullable, sin `UNIQUE`); resto igual.
- Se elimina `CONTROL_CODE_TAKEN`; se agrega `TEMPLATE_INCOMPLETE` (422).
- Nuevo `library/domain/control-tree.ts` (pura) y su suite de pruebas con los códigos de COBIT, NIST, ASFI y las
  numeraciones sin puntos que hoy fallan.
- Importación/exportación por `nivel`, con ida y vuelta probada.
- Migración inicial regenerada (no hay BD desplegada).
