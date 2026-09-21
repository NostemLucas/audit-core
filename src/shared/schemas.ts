import { z } from 'zod'
import { LIMITS } from './limits.js'

/**
 * Texto opcional de entrada: se recorta, y un texto vacío equivale a "sin texto" (se guarda NULL, nunca ""). Fragmentos
 * de esquema que usan varios módulos; cada módulo compone con ellos sus esquemas.
 */
export const optionalText = (max: number = LIMITS.text) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((text) => text || null)
