/**
 * Longitudes máximas de los textos de entrada: ÚNICA fuente (la BD guarda `text` sin límite; lo que se acepta lo
 * decide la validación de cada borde). Se importan desde los esquemas Zod de los módulos.
 */
export const LIMITS = {
  /** Nombres: organización, escala, plantilla, elemento de alcance. */
  name: 200,
  /** Textos cortos: etiqueta de una opción, título de un control, referencia. */
  title: 500,
  /** Textos largos sin formato: descripciones, hallazgos, notas. */
  text: 20_000,
} as const
