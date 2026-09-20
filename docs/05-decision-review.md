# Audit Core — Revisión de decisiones y protocolo para contrastarlas con una auditoría real

Estado: **documento de trabajo** (las correcciones técnicas de §1.1 son propuestas hasta que se aprueben; `01` aún describe el modelo anterior). Las decisiones tomadas hasta ahora salen de leer el proyecto anterior y de conversaciones,
no de haber corrido una auditoría de verdad. Este documento separa lo que es un **error técnico** (se corrige ya) de lo que es
una **decisión metodológica** (solo una auditoría real puede confirmarla), y dice cómo contrastarlas.

## 1. El modelo de puntuación, revisado con cifras

Fórmula heredada: por criterio `score = min(alcanzado / esperado, 1) × 100`; general y por dominio = `Σ(score × peso) / Σ(peso)`
sobre lo evaluado y aplicable. Se reprodujo con casos concretos (script en el historial de la conversación):

### 1.1 Errores técnicos (se corrigen sin necesidad de contrastar)

**Los pesos "deben sumar 100" con 2 decimales están rotos.** El reparto uniforme del proyecto anterior
(`round(100/n, 2)` y el último absorbe la diferencia) da:

| Criterios | Cada uno | El último | |
|---|---|---|---|
| 93 (ISO 27001:2022) | 1,08 | **0,64** | pesa un 41 % menos: sesgo silencioso en el caso más típico |
| 450 | 0,22 | 1,22 | desigual |
| 601 | 0,17 | **−2** | negativo: viola el `CHECK weight ≥ 0`; la auditoría no se puede crear |

→ **Pesos relativos**: un número positivo por criterio (por defecto 1) que se **normaliza al calcular** (`peso / Σ pesos`). No hay
suma que cuadrar ni redondeo, y agregar o quitar un criterio no obliga a rebalancear. La pantalla puede mostrar el porcentaje
resultante. Desaparecen `WEIGHTS_SUM_INVALID` y el reparto inicial; el `CHECK` pasa a `weight > 0`.

**El puntaje guardado se desactualiza.** Con nivel esperado por criterio y una operación masiva que lo cambia, un `score`
guardado (60 %) queda distinto del real (100 %) salvo que cada cambio lo recalcule: dos fuentes de la misma verdad. → **Se
elimina `evaluations.score`**: se calcula al leer a partir de los niveles alcanzado y esperado (la escala son unas decenas de
filas). Los agregados se calculan con los niveles y los pesos exactos, no con puntajes ya redondeados. Para lo cerrado sigue
`audits.finalScore` (instantánea al cerrar).

**El objetivo del gráfico** ignoraba el nivel esperado por control (usaba el máximo de la escala). Ya decidido: promedio
ponderado por dominio (`04` §4.5).

### 1.2 Decisiones metodológicas (necesitan una auditoría real)

**(a) El % depende de dónde empieza la escala.** Con esperado 3:

| Alcanzado | Escala 0–5 (COBIT) | Escala 1–5 (CMMI) | CMMI normalizando el mínimo |
|---|---|---|---|
| 0 | 0 % | — | — |
| 1 | 33,3 % | 33,3 % | **0 %** |
| 2 | 66,7 % | 66,7 % | 50 % |
| 3 | 100 % | 100 % | 100 % |

El mismo estado real ("inicial") vale 33 % en CMMI y 0 % en COBIT solo por cómo se numera. La alternativa
`(alcanzado − mínimo) / (esperado − mínimo)` da 0 % al nivel más bajo en cualquier escala. Cuál es la correcta depende de qué
significa el nivel más bajo: en COBIT, "0 = incompleto" es ausencia; en CMMI, "1 = inicial" existe de forma ad hoc. **Hay que
ver qué hacen los auditores reales.** Además, los niveles de madurez son ordinales (el 4 no es "el doble" del 2); dividir es una
convención, no una medida.

**(b) El promedio ponderado compensa.** 50 criterios, 49 al 100 % y **uno crítico al 0 %** → 98 % general (90,7 % aunque ese
criterio pese 5×). Una auditoría real no se decide por un promedio: un incumplimiento grave puede impedir la conclusión favorable
aunque el resto esté bien. Opciones, de menor a mayor:
1. informar **además** la cuenta de incumplimientos (criterios por debajo del esperado) y la lista de los peores (ya existía el
   "top 5 controles débiles");
2. distribución por nivel en cada dominio (cuántos criterios en cada nivel), más honesta que la media de un dato ordinal;
3. un marcador de **criterio crítico**: si uno está por debajo del esperado, el dominio y el resultado general se marcan.

**(c) Lo que no está modelado y una auditoría real casi seguro tiene:**
- **clasificación del hallazgo** (conformidad, no conformidad mayor/menor, observación, oportunidad de mejora): hoy solo hay
  un nivel y un texto;
- **evidencia obligatoria**: nada impide completar un criterio sin adjuntar evidencia;
- **el seguimiento**: en la práctica suele **revisar solo lo que falló** en la auditoría anterior; hoy un seguimiento crea
  evaluaciones para **todas** las hojas.

## 2. Revisión de todas las decisiones

Confianza = cuánto respaldo tienen (`alta`: lo confirmó el usuario o hay datos; `media`: razonable pero sin contrastar;
`baja`: hay indicios de que está mal). Costo de cambiarla después: `bajo` (una columna o un caso de uso), `alto` (toca el modelo
y los datos).

| # | Decisión | Confianza | Costo de cambio | Qué contrastar con una auditoría real |
|---|---|---|---|---|
| 1 | Plantilla identificada por su nombre (sin `code`/`version`) | alta | bajo | — |
| 2 | Plantilla **publicada inmutable**; corregir = clonar | media | medio | ¿Se corrigen plantillas en uso? Con esto, las auditorías ya iniciadas siguen con la versión vieja |
| 3 | Árbol de profundidad variable; la hoja se evalúa; el primer nivel es el dominio | alta | alto | Confirmado por el usuario |
| 4 | **Una escala por auditoría**, no por sección | media | **alto** | ¿Una misma auditoría mezcla "cumple/no cumple" (cláusulas) con madurez (controles)? |
| 5 | Alcance propio de la auditoría; el seguimiento lo hereda sin ampliarlo | media | medio | ¿Cómo se define el alcance de un seguimiento real? |
| 6 | Seguimiento = auditoría nueva sobre una cerrada, **con todas las hojas** | **baja** | alto | ¿Se revisa todo o solo los incumplimientos? (§1.2c) |
| 7 | Flujo de la evaluación: iniciar → completar → aprobar/devolver, con rondas; roles líder/inspector | media | alto | ¿Aprueba el líder **cada** criterio? ¿Hay auditorías de un solo auditor? |
| 8 | Cerrar exige todo aprobado | media | bajo | ¿Se cierra con pendientes justificados? |
| 9 | Nivel esperado **por criterio**, con motivo; iniciar exige fijarlos todos | alta | medio | Confirmado por el usuario |
| 10 | Fórmula `min(A/E,1)×100`, promedio ponderado | **baja** | alto | §1.2 (a) y (b) |
| 11 | Pesos que suman 100 | **baja (error)** | medio | Se reemplaza por pesos relativos (§1.1) |
| 12 | Puntaje guardado por criterio | **baja (error)** | medio | Se elimina; se calcula (§1.1) |
| 13 | Sin notificaciones ni feed global | alta | bajo | Reversible: es un manejador nuevo |
| 14 | Usuario mínimo; roles desde los grupos de Authentik | alta | bajo | — |
| 15 | Evidencia en Nextcloud, por criterio y ronda | media | medio | ¿Qué se exige adjuntar? ¿Evidencia a nivel de auditoría, no solo de criterio? |
| 16 | Hallazgos sugeridos por control y nivel | media | bajo | ¿Los auditores los usan de verdad? Si no, se elimina |
| 17 | Informe `.docx` desde una plantilla | media | medio | **Un informe real terminado** valida qué secciones, gráficos y cifras se necesitan |
| 18 | Sin guía del auditor en la plantilla | alta | bajo | Confirmado por el usuario |

Las de confianza baja o costo alto (4, 6, 7, 10) son las que conviene contrastar **antes** de la Fase 3, que es cuando se
construyen.

## 3. Cómo contrastar con una auditoría real

Sirve **una sola auditoría terminada**, idealmente una ISO 27001 con su informe final.

1. **Reunir cinco insumos:** (i) la plantilla usada (estructura); (ii) la escala y sus niveles; (iii) por criterio: nivel
   esperado, nivel alcanzado, si era no aplicable, peso si lo hubo y el hallazgo; (iv) el informe final con sus gráficas y
   conclusiones; (v) cómo fue el equipo (quién evaluó, quién aprobó).
2. **Reproducir:** cargar esos datos como caso de prueba de `scoring.ts` (Fase 3), calcular y comparar el % por dominio y el
   general con los del informe real.
3. **Clasificar cada diferencia:** (a) error nuestro, (b) el auditor usa otro método (se decide), (c) faltan datos.
4. Las diferencias resuelven §1.2 y la tabla anterior.

Formato sugerido para los datos (una fila por criterio; sirve un Excel o un CSV):

| dominio | referencia | criterio (título) | esperado | alcanzado | no aplica | peso | hallazgo |
|---|---|---|---|---|---|---|---|
| A.5 Políticas | A.5.1.1 | Existe política de seguridad aprobada | 3 | 2 | no | 1 | Sin firma del CISO |

## 4. Preguntas para hacerle a quien hizo esa auditoría

1. ¿Cómo obtienes el porcentaje de un dominio? ¿Y el general? ¿Lo informas, o informas el nivel de madurez?
2. ¿El nivel más bajo de la escala significa "no existe" o "existe pero informal"? ¿Cuánto vale en tu porcentaje?
3. ¿Ponderas los criterios? ¿Con qué criterio (riesgo, criticidad)? ¿Hay criterios cuyo incumplimiento cambia la conclusión
   sin importar el promedio?
4. ¿Clasificas los hallazgos (no conformidad mayor/menor, observación)? ¿En el informe aparecen contados?
5. ¿Se exige evidencia para calificar un criterio? ¿A qué nivel (criterio, dominio, auditoría)?
6. ¿Aprueba una segunda persona cada criterio, o se revisa por dominio o al final?
7. En un seguimiento, ¿se vuelve a evaluar todo o solo lo que falló?
8. ¿Qué gráficas y cifras van en el informe final? (el radar por dominio, ¿en % o en niveles?)
9. ¿Se mezclan formas de evaluar en una misma auditoría (cumple/no cumple y madurez)?

## 5. Qué propongo corregir ya (con tu visto bueno) y qué espera

| Propuesta: corregir en la Fase 2/3 sin esperar (pendiente de visto bueno) | Espera a la auditoría real |
|---|---|
| Pesos relativos; se elimina el reparto a 100 | Punto cero de la escala (§1.2a) |
| Se elimina `evaluations.score` (se calcula) | Marcador de criterio crítico / cuenta de incumplimientos (§1.2b) |
| Promedio ponderado por dominio como definición única | Clasificación de hallazgos y evidencia obligatoria (§1.2c) |
| Nivel esperado por criterio; obligatorio para iniciar | Seguimiento: todas las hojas o solo las fallidas (#6) |

## 6. Actualización tras la respuesta del usuario (decisión provisional, a validar con una auditoría real)

Lo que se describió como práctica de sus auditores reemplaza a la fórmula heredada y resuelve buena parte de §1:

| Punto | Resolución |
|---|---|
| Cómo se mide un dominio (§1.2a) | **Dos promedios en niveles**, no un porcentaje: nivel esperado promedio y nivel alcanzado promedio de las hojas del dominio, y su brecha. Al comparar niveles con niveles en la misma escala, el punto cero de la escala deja de importar. Un porcentaje, si hiciera falta, sería derivado (`Σ min(A,E) / Σ E`) y no se guarda. |
| Un incumplimiento (§1.2b) | Es una **no conformidad de esa hoja** (alcanzado < esperado), **no** del dominio. No hay marcador de criterio crítico ni "puerta". El informe lista y cuenta las hojas por debajo del esperado, por dominio (dato derivado). |
| Pesos (§1.1) | **Se eliminan.** Cada hoja cuenta igual y su influencia sale de sus niveles; lo no aplicable se excluye. Se van `evaluations.weight`, la edición masiva de pesos y `WEIGHTS_SUM_INVALID`. Reversible: una columna con valor 1 por defecto, sin migrar datos. |
| Puntaje guardado (§1.1) | **Se elimina** `evaluations.score` y, sin ponderación, también `audits.finalScore`: todo se calcula desde los niveles. |
| Clasificación de hallazgos, evidencia obligatoria (§1.2c) | Sin decidir: "depende de lo que se quiere revisar". No se construyen ahora. |

**Reglas de cálculo propuestas** (`audits/domain/scoring.ts`, única fuente):
1. Nivel esperado y alcanzado de un dominio o de la auditoría = **promedio simple** de los niveles de sus hojas.
2. Ambos promedios se calculan sobre **las mismas hojas**: las evaluadas y aplicables (no aplicables excluidas), para que sean
   comparables. El avance de una auditoría en curso se muestra aparte.
3. El general de la auditoría es el promedio de **todas las hojas** (un dominio con más criterios influye más). *Pendiente de
   confirmar frente al promedio de promedios por dominio.*
4. La brecha de una hoja es `alcanzado − esperado`; una hoja con brecha negativa es una no conformidad.

**Consecuencias que hay que atender:**
- **Los resultados de una auditoría cerrada deben ser reproducibles.** Sin instantánea guardada, dependen de los valores de los
  niveles de la escala: se debe **impedir editar el `value` de un nivel** de una escala ya usada por alguna auditoría (hoy solo se
  impide borrarlo). Error nuevo: `SCALE_LEVEL_IN_USE` también para la edición del valor.
- **Un seguimiento (y una auditoría parcial) elige qué criterios incluye**, por defecto los que no cumplieron. Como las
  evaluaciones son una por (auditoría, hoja), basta con crear filas solo para los criterios incluidos. Pendiente de confirmar.
- `01` (modelo de datos) todavía describe `weight`, `score` y `finalScore`; se actualizará junto con el schema al empezar la
  Fase 2, una vez confirmado esto.

## 7. Cómo funciona una auditoría real (referencia general, NO verificada contra la institución del usuario)

Conocimiento general de las normas de referencia (ISO 19011, ISO/IEC 17021-1, ISO/IEC 33020 con COBIT PAM, CMMI/SCAMPI). Su
institución o su regulador (p. ej. ASFI) pueden diferir: por eso §8 lista qué comprobar.

| | Auditoría de **conformidad** | Evaluación de **madurez/capacidad** |
|---|---|---|
| Ejemplos | ISO 27001 (certificación, interna), gap assessment | COBIT (PAM), CMMI |
| Se califica, en cada requisito | cumple / parcialmente / no cumple / no aplica | cumplimiento de atributos: N (0–15 %), P (>15–50 %), L (>50–85 %), F (>85–100 %) |
| Origen del número | ISO 27001 **no define puntuación**; un % es una convención de reporte | el **nivel 0–5 se deriva** de esas calificaciones y se asigna al **proceso**, no a cada pregunta |
| Salida | hallazgos: no conformidad mayor / menor, observación, oportunidad de mejora | nivel de capacidad por proceso frente a un objetivo |

**Consecuencias para el modelo.**
- En una hoja de ISO 27001 lo que se califica es **cumplimiento**. Asignar un "nivel 0–5" a cada pregunta mezclaba las dos familias.
- El número de una opción de escala **no es una medida sino un puntaje de categoría** (una regla de crédito: p. ej. Cumple 100 /
  Parcial 50 / No cumple 0), decidido por la función de auditoría y por eso configurable por escala. Distinto de la
  **importancia de un criterio**, que se eliminó (§6).
- **El modelo ya cubre ambas familias**: la escala es una lista ordenada de opciones con etiqueta y puntaje. Con una escala de
  cumplimiento, el promedio de dominio es un % de cumplimiento; con una de madurez, un nivel medio; la misma fórmula (§6).
- El nivel esperado en una escala de cumplimiento será casi siempre "Cumple"; sigue pudiendo ser "Parcial" con su motivo.
- **No aplicable** equivale a excluir un control de la Declaración de Aplicabilidad (ISO 27001, 6.1.3), con su justificación.
- **Falta modelar la clasificación del hallazgo** (conformidad / no conformidad mayor o menor / observación / oportunidad de
  mejora): es la salida real de una auditoría de conformidad. Propuesta: enum en la evaluación, separado del puntaje.
- **El seguimiento** verifica el cierre de las no conformidades de la auditoría anterior: respalda elegir los criterios a revisar.
- El campo `value` de una opción se llamará **puntaje** en la interfaz y en la documentación (la columna puede mantener su nombre).

## 8. Qué comprobar con la auditoría real

1. ¿Las hojas se califican como cumple / parcial / no cumple, o con niveles de madurez? ¿Cuántas categorías y cómo se llaman?
2. ¿Qué puntaje da cada categoría al calcular un % (100/50/0, otro)? ¿O no se calcula ningún %?
3. ¿Los hallazgos se clasifican (mayor, menor, observación)? ¿El informe los cuenta?
4. ¿Se audita ISO 27001 como conformidad, como madurez, o las dos cosas según la sección?

## 9. Contraste con una segunda opinión (texto pegado por el usuario)

Se comparó con una explicación independiente. **Verificado** en fuente pública (ISO/IEC 15504, base de COBIT PAM): cada
*atributo de proceso* se califica N/P/L/F con rangos 0–15 %, >15–50 %, >50–85 % y >85–100 %, según la evidencia contra
indicadores de práctica; el nivel de capacidad se determina a partir de esas calificaciones, no se promedia.

| Punto de esa opinión | Evaluación |
|---|---|
| ISO 27001 no define "Cumple = 100 %"; eso es una metodología propia | **De acuerdo** (igual que §7) |
| El 100/50/0 es el puntaje de la opción de la escala, no el peso del control | **De acuerdo** (igual que §7) |
| El nivel COBIT 0–5 es resultado de evaluar atributos de un **proceso**; no se promedian niveles para decir "nivel 3,4" | **De acuerdo, y afecta a §6**: el promedio de niveles es una **convención de reporte**, no una medida de capacidad. Debe llamarse "puntaje/madurez promedio (indicativo)", nunca "nivel COBIT" |
| Hay tres cosas distintas: puntaje de la opción, peso del criterio y nivel COBIT | **De acuerdo** en que son conceptos distintos |
| "No eliminaría `weight` todavía" | **Sin convencer**: probar que son conceptos distintos no prueba que el producto necesite el peso; es una pregunta de hecho (¿ponderan sus auditores?) y costo bajo en ambos sentidos (columna con valor 1). Se mantiene eliminado, provisional; queda en las preguntas de §8 |
| Modelar `EvaluationMethod` (ISO conformidad / COBIT PAM) como metodologías distintas | **Prematuro.** El producto anterior usaba 0–5 como **escala de calificación de controles** (madurez por control), no un assessment PAM de procesos × atributos. Ver decisión D-PAM |
| N/A como opción de escala con valor `NULL` | **No**: aquí es un indicador aparte con justificación obligatoria (equivale a excluir un control de la Declaración de Aplicabilidad) |

**Decisión pendiente D-PAM.** ¿El producto debe hacer una evaluación de capacidad **conforme a COBIT PAM** (procesos ×
atributos × evidencia, con reglas para determinar el nivel), o usar una escala 0–5 como **madurez por control**?
- *Madurez por control* (recomendada, lo que ya existía): se conserva el modelo. Se llama así y no "COBIT 5", y el informe
  dice "madurez promedio (indicativa)".
- *PAM conforme*: es un método de evaluación distinto (la unidad es proceso-atributo, no la hoja). Se agrega después como
  `audits.method` (aditivo); no se contorsiona el modelo actual para acomodarlo ahora.

**Ajuste a §6.** Además de los promedios, el resultado de un dominio incluye la **distribución por opción** (cuántos criterios
en cada opción: p. ej. 12 cumple / 3 parcial / 2 no cumple). En una auditoría de conformidad es el resultado más natural y
no depende de tratar categorías ordinales como números; el promedio queda como resumen.

## 10. Ponderación por dimensión: de dónde sale (o no) un peso

**El peso no lo define ningún método.** ISO 27001 no pondera; en COBIT PAM el nivel de un proceso se determina por reglas sobre las
calificaciones de sus atributos y no se pondera nada. Lo que cada método define es qué se califica (la escala) y contra qué se
compara (el nivel esperado). Cuánto cuenta cada criterio en un agregado es una **política de la función de auditoría**.

| | Conformidad (cumple / parcial / no cumple) | Capacidad o madurez (0–5) |
|---|---|---|
| Pregunta | ¿se satisface el requisito? | ¿qué tan establecido está el control o proceso? |
| Se compara con | el requisito: lo esperado es casi siempre "Cumple" | un objetivo que varía por criterio |
| Agregado | % de cumplimiento + conteo por opción | madurez promedio frente al objetivo (indicativa) |
| Dónde aparece la "importancia" | en qué se incluye y en la no conformidad de cada hoja | **en el nivel esperado** (crítico = 4, menor = 2) |

**Cómo se pondera una auditoría:** todos los criterios aplicables cuentan igual; lo no aplicable se excluye. Ejemplo con seis
criterios. *Conformidad* (100/50/0, esperado Cumple): 4 cumple, 1 parcial, 1 no cumple → 75 %, distribución 4/1/1, dos hojas con
brecha. *Madurez* (esperados 3,3,4,4,2,2; alcanzados 3,2,4,2,2,1): esperada 3,0, alcanzada 2,33, brecha −0,67, tres hojas por debajo.

**Reglas.**
- Las dos dimensiones **no se suman** en un solo número. Una escala por auditoría; cada auditoría informa su dimensión.
- Si se necesitara ambas dimensiones para el mismo conjunto de criterios en una misma auditoría, serían dos calificaciones por
  criterio: un cambio mayor del modelo. Pregunta abierta.
- Un peso, si un día hiciera falta, sería una columna opcional con valor 1 por defecto (`Σ(peso × valor) / Σ(peso)`), decidida por
  la política de riesgo de la institución. No se construye ahora.

