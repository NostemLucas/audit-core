import { loadEnv } from '../../src/platform/config/index.js'

/** Puerto 1: rechaza la conexión al instante. Los tests HTTP sin BD no llegan a consultarla. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/x'

export const TEST_ISSUER = 'https://auth.test/application/o/audit/'
export const TEST_CLIENT_ID = 'audit-test-client'

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    AUTHENTIK_ISSUER: TEST_ISSUER,
    AUTHENTIK_CLIENT_ID: TEST_CLIENT_ID,
    ...overrides,
  })
}
