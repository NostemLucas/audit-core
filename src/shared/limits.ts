/**
 * Longitudes máximas de los textos de entrada: ÚNICA fuente (la BD guarda `text` sin límite; lo que se acepta lo
 * decide la validación de cada borde). Se importan desde los esquemas Zod de los módulos.
 */
export const LIMITS = {
  /** Nombres: organización, escala, plantilla, elemento de alcance. */
  name: 200,
  /** Textos cortos: etiqueta de una opción, título de un control, referencia. */
  title: 500,
  /** Máximo de opciones de una escala (un tope contra abusos; el mínimo lo fija la invariante de la escala). */
  scaleLevels: 20,
  /** Niveles máximos de profundidad del árbol de una plantilla (una norma real llega a 4-6). */
  controlDepth: 10,
  /** Tamaño máximo de un archivo de importación. */
  importBytes: 5 * 1024 * 1024,
  /** Filas máximas de un archivo de importación (una norma real tiene cientos; esto es un tope contra abusos). */
  importRows: 5000,
  /** Elementos de alcance que se pueden dar al crear una auditoría (un tope contra abusos). */
  scopeItems: 100,
  /** Criterios que se pueden asignar (o desasignar) en una sola operación. */
  assignBatch: 1000,
  /** Textos largos sin formato: descripciones, hallazgos, notas. */
  text: 20_000,
} as const
