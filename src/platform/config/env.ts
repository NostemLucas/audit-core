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

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Cadena de conexión de PostgreSQL. */
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'debe ser una URL postgresql://'),
  /** `iss` exacto que emite Authentik (con la barra final), p. ej. https://auth.ejemplo.com/application/o/audit/ */
  AUTHENTIK_ISSUER: z.url(),
  /** Client ID de la aplicación en Authentik: es el `aud` que debe traer el token. */
  AUTHENTIK_CLIENT_ID: z.string().min(1),
  /** JWKS con las claves públicas. Por defecto `<AUTHENTIK_ISSUER>jwks/`, que es donde Authentik lo publica. */
  AUTHENTIK_JWKS_URI: z.url().optional(),
  /** Nivel mínimo de log. Por defecto: `silent` en test, `info` en el resto. */
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  /** Salida legible en consola en vez de JSON. Por defecto solo en desarrollo; `pino-pretty` es dependencia de desarrollo. */
  LOG_PRETTY: z.stringbool().optional(),
  /** Orígenes permitidos por CORS, separados por coma. Vacío = ninguno. */
  CORS_ORIGINS: csv,
  /** Ventana del rate limit global, en milisegundos. */
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  /** Peticiones máximas por ventana y por cliente. */
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  /** Raíz del servidor Nextcloud (WebDAV y OCS cuelgan de ahí; sin `/` final). */
  NEXTCLOUD_BASE_URL: z.url(),
  /** Cuenta de servicio con la que el backend habla con Nextcloud (Basic Auth). */
  NEXTCLOUD_SERVICE_USER: z.string().min(1),
  NEXTCLOUD_SERVICE_PASSWORD: z.string().min(1),
  /** Firma HMAC del webhook de evidencia (docs/07 §1.2). */
  NEXTCLOUD_WEBHOOK_SECRET: z.string().min(1),
})

/** Aplica los valores por defecto que dependen de `NODE_ENV`. */
const resolvedEnvSchema = envSchema.transform((env) => ({
  ...env,
  LOG_LEVEL: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? ('silent' as const) : ('info' as const)),
  LOG_PRETTY: env.LOG_PRETTY ?? env.NODE_ENV === 'development',
  AUTHENTIK_JWKS_URI: env.AUTHENTIK_JWKS_URI ?? `${env.AUTHENTIK_ISSUER.replace(/\/?$/, '/')}jwks/`,
}))

export type Env = z.output<typeof resolvedEnvSchema>

/** Falla al arrancar, listando TODAS las variables inválidas de una vez. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = resolvedEnvSchema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    throw new Error(`Configuración de entorno inválida:\n${lines.join('\n')}`)
  }
  return result.data
}
