import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/platform/config/index.js'

describe('loadEnv', () => {
  it('aplica los valores por defecto', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: [],
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
    })
  })

  it('convierte tipos y separa los orígenes CORS', () => {
    const env = loadEnv({ PORT: '4000', CORS_ORIGINS: ' https://a.com , https://b.com ,', THROTTLE_LIMIT: '5' })
    expect(env.PORT).toBe(4000)
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com'])
    expect(env.THROTTLE_LIMIT).toBe(5)
  })

  it('falla listando TODAS las variables inválidas, no solo la primera', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging', PORT: '99999', THROTTLE_LIMIT: '0' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*THROTTLE_LIMIT/,
    )
  })
})
