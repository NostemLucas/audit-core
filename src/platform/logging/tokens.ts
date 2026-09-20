/** El logger base de pino (`pino.Logger`). */
export const PINO = Symbol('PINO')
/** Destino de las líneas de log. Por defecto stdout; los tests lo reemplazan para capturarlas. */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION')
