import { z } from 'zod'

/**
 * Única fuente de las variables de entorno. Nadie más lee `process.env` (regla de lint).
 * Solo entran las variables que algo usa hoy; cada fase agrega las suyas.
 */
const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Orígenes permitidos por CORS, separados por coma. Vacío = ninguno. */
  CORS_ORIGINS: csv,
  /** Ventana del rate limit global, en milisegundos. */
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  /** Peticiones máximas por ventana y por cliente. */
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
})

export type Env = z.infer<typeof envSchema>

/** Falla al arrancar, listando TODAS las variables inválidas de una vez. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    throw new Error(`Configuración de entorno inválida:\n${lines.join('\n')}`)
  }
  return result.data
}
