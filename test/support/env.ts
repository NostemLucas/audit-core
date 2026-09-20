import { loadEnv } from '../../src/platform/config/index.js'

/** Puerto 1: rechaza la conexión al instante. Los tests HTTP sin BD no llegan a consultarla. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/x'

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({ NODE_ENV: 'test', DATABASE_URL: UNREACHABLE_DATABASE_URL, ...overrides })
}
