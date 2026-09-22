import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/platform/config/index.js'

const DB_URL = 'postgresql://u:p@localhost:5432/db'
const ISSUER = 'https://auth.ejemplo.com/application/o/audit/'
const BASE = {
  DATABASE_URL: DB_URL,
  AUTHENTIK_ISSUER: ISSUER,
  AUTHENTIK_CLIENT_ID: 'cid',
  NEXTCLOUD_BASE_URL: 'https://nextcloud.ejemplo.com',
  NEXTCLOUD_SERVICE_USER: 'audit-core',
  NEXTCLOUD_SERVICE_PASSWORD: 'p',
  NEXTCLOUD_WEBHOOK_SECRET: 's',
}

describe('loadEnv', () => {
  it('aplica los valores por defecto', () => {
    expect(loadEnv(BASE)).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: DB_URL,
      AUTHENTIK_ISSUER: ISSUER,
      AUTHENTIK_CLIENT_ID: 'cid',
      AUTHENTIK_JWKS_URI: `${ISSUER}jwks/`,
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: true,
      CORS_ORIGINS: [],
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
      NEXTCLOUD_BASE_URL: 'https://nextcloud.ejemplo.com',
      NEXTCLOUD_SERVICE_USER: 'audit-core',
      NEXTCLOUD_SERVICE_PASSWORD: 'p',
      NEXTCLOUD_WEBHOOK_SECRET: 's',
    })
  })

  it('convierte tipos y separa los orígenes CORS', () => {
    const env = loadEnv({
      ...BASE,
      PORT: '4000',
      CORS_ORIGINS: ' https://a.com , https://b.com ,',
      THROTTLE_LIMIT: '5',
    })
    expect(env.PORT).toBe(4000)
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com'])
    expect(env.THROTTLE_LIMIT).toBe(5)
  })

  it('falla listando TODAS las variables inválidas, no solo la primera', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging', PORT: '99999', THROTTLE_LIMIT: '0' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL[\s\S]*AUTHENTIK_ISSUER[\s\S]*AUTHENTIK_CLIENT_ID[\s\S]*THROTTLE_LIMIT/,
    )
  })

  it('DATABASE_URL es obligatoria y debe ser una URL postgresql://', () => {
    expect(() => loadEnv({ ...BASE, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
    expect(() => loadEnv({ ...BASE, DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/)
  })

  describe('Authentik', () => {
    it('el issuer y el client id son obligatorios', () => {
      expect(() => loadEnv({ ...BASE, AUTHENTIK_ISSUER: undefined })).toThrow(/AUTHENTIK_ISSUER/)
      expect(() => loadEnv({ ...BASE, AUTHENTIK_CLIENT_ID: '' })).toThrow(/AUTHENTIK_CLIENT_ID/)
    })

    it('el issuer debe ser una URL', () => {
      expect(() => loadEnv({ ...BASE, AUTHENTIK_ISSUER: 'no-es-una-url' })).toThrow(/AUTHENTIK_ISSUER/)
    })

    it('el JWKS se deriva del issuer, con o sin barra final', () => {
      expect(loadEnv({ ...BASE, AUTHENTIK_ISSUER: 'https://a.com/application/o/x/' }).AUTHENTIK_JWKS_URI).toBe(
        'https://a.com/application/o/x/jwks/',
      )
      expect(loadEnv({ ...BASE, AUTHENTIK_ISSUER: 'https://a.com/application/o/x' }).AUTHENTIK_JWKS_URI).toBe(
        'https://a.com/application/o/x/jwks/',
      )
    })

    it('el JWKS se puede fijar explícitamente', () => {
      expect(loadEnv({ ...BASE, AUTHENTIK_JWKS_URI: 'https://otro.com/jwks/' }).AUTHENTIK_JWKS_URI).toBe(
        'https://otro.com/jwks/',
      )
    })
  })

  describe('Nextcloud', () => {
    it('la URL base, la cuenta de servicio y el secreto del webhook son obligatorios', () => {
      expect(() => loadEnv({ ...BASE, NEXTCLOUD_BASE_URL: undefined })).toThrow(/NEXTCLOUD_BASE_URL/)
      expect(() => loadEnv({ ...BASE, NEXTCLOUD_SERVICE_USER: '' })).toThrow(/NEXTCLOUD_SERVICE_USER/)
      expect(() => loadEnv({ ...BASE, NEXTCLOUD_SERVICE_PASSWORD: '' })).toThrow(/NEXTCLOUD_SERVICE_PASSWORD/)
      expect(() => loadEnv({ ...BASE, NEXTCLOUD_WEBHOOK_SECRET: '' })).toThrow(/NEXTCLOUD_WEBHOOK_SECRET/)
    })

    it('la URL base debe ser una URL', () => {
      expect(() => loadEnv({ ...BASE, NEXTCLOUD_BASE_URL: 'no-es-una-url' })).toThrow(/NEXTCLOUD_BASE_URL/)
    })
  })
})
