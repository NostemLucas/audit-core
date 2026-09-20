import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/platform/config/index.js'

const DB_URL = 'postgresql://u:p@localhost:5432/db'

describe('loadEnv', () => {
  it('aplica los valores por defecto', () => {
    expect(loadEnv({ DATABASE_URL: DB_URL })).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: DB_URL,
      PORT: 3000,
      CORS_ORIGINS: [],
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
    })
  })

  it('convierte tipos y separa los orígenes CORS', () => {
    const env = loadEnv({ DATABASE_URL: DB_URL, PORT: '4000', CORS_ORIGINS: ' https://a.com , https://b.com ,', THROTTLE_LIMIT: '5' })
    expect(env.PORT).toBe(4000)
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com'])
    expect(env.THROTTLE_LIMIT).toBe(5)
  })

  it('falla listando TODAS las variables inválidas, no solo la primera', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging', PORT: '99999', THROTTLE_LIMIT: '0' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL[\s\S]*THROTTLE_LIMIT/,
    )
  })

  it('DATABASE_URL es obligatoria y debe ser una URL postgresql://', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/)
    expect(() => loadEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/)
  })
})
