/**
 * ÚNICA lista de campos que nunca deben llegar a un log. Se aplican a cualquier objeto que se registre, a uno y a dos
 * niveles de profundidad. (Un secreto embebido en el TEXTO de un mensaje no se puede censurar: por eso los mensajes son
 * texto fijo y lo variable va en campos; ver docs/02 §13.)
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'jwt',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'x-api-key',
] as const

export const REDACTED_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `headers.${key}`,
  `*.headers.${key}`,
])

export const REDACTED_CENSOR = '[REDACTED]'
