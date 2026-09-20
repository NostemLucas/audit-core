import { Controller, Get, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { errors, type JWTVerifyGetKey } from 'jose'
import { ClsService } from 'nestjs-cls'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/configure-app.js'
import { rolesFromGroups } from '../src/modules/identity/authentik/roles-from-groups.js'
import {
  CurrentUser,
  JWT_KEYS,
  USER_RESOLVER,
  type AuthenticatedUser,
  type TokenClaims,
} from '../src/platform/auth/index.js'
import { Can, NoAbilityRequired, Public } from '../src/platform/authz/index.js'
import { ENV } from '../src/platform/config/index.js'
import { LOG_DESTINATION } from '../src/platform/logging/index.js'
import { testEnv } from './support/env.js'
import { createTestIssuer } from './support/identity.js'

@Controller('__authz')
class AuthzProbeController {
  constructor(private readonly cls: ClsService) {}

  @Get('audits')
  @Can('read', 'Audit')
  readAudits() {
    return { ok: true }
  }

  @Post('templates')
  @Can('create', 'Template')
  createTemplate() {
    return { ok: true }
  }

  @Get('me')
  @NoAbilityRequired()
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user, cls: this.cls.get('userId') }
  }

  @Get('open')
  @Public()
  open() {
    return { open: true, cls: this.cls.get('userId') ?? null }
  }
}

/** Sustituye a la sincronización con la BD: aísla la verificación del token y la autorización. */
const fakeResolver = {
  resolve: async (claims: TokenClaims): Promise<AuthenticatedUser> => ({
    id: '00000000-0000-7000-8000-00000000abcd',
    email: String(claims['email']),
    username: String(claims['preferred_username']),
    name: String(claims['name']),
    roles: rolesFromGroups(Array.isArray(claims['groups']) ? (claims['groups'] as string[]) : []),
  }),
}

let app: NestExpressApplication | undefined
let logs: Array<Record<string, any>> = []

async function boot(keys: JWTVerifyGetKey) {
  logs = []
  const env = testEnv({ LOG_LEVEL: 'debug' })
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [AuthzProbeController] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(JWT_KEYS)
    .useValue(keys)
    .overrideProvider(USER_RESOLVER)
    .useValue(fakeResolver)
    .overrideProvider(LOG_DESTINATION)
    .useValue({ write: (line: string) => void logs.push(JSON.parse(line)) })
    .compile()
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  configureApp(app, env)
  await app.init()
  return app.getHttpServer()
}

afterEach(async () => {
  await app?.close()
  app = undefined
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('autenticación: verificación del token', () => {
  it('un token válido pasa, y el usuario queda en request.user y en el contexto ambiental', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(issuer.keys)
    const res = await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await issuer.sign()))
      .expect(200)
    expect(res.body.data.user).toMatchObject({ username: 'Ana.Perez', roles: ['AUDITOR'] })
    expect(res.body.data.cls).toBe('00000000-0000-7000-8000-00000000abcd') // los sellos, el logger y los eventos lo leen de aquí
  })

  it('sin cabecera Authorization → 401 TOKEN_INVALID', async () => {
    const server = await boot((await createTestIssuer()).keys)
    const res = await request(server).get('/api/v1/__authz/me').expect(401)
    expect(res.body.error.code).toBe('TOKEN_INVALID')
  })

  it.each([['Basic dXNlcjpwYXNz'], ['Bearer'], ['Bearer '], ['Token abc'], ['bearer'], ['']])(
    'cabecera "%s" → 401',
    async (header) => {
      const server = await boot((await createTestIssuer()).keys)
      await request(server).get('/api/v1/__authz/me').set('authorization', header).expect(401)
    },
  )

  it('un texto cualquiera como token → 401', async () => {
    const server = await boot((await createTestIssuer()).keys)
    await request(server).get('/api/v1/__authz/me').set(bearer('esto-no-es-un-jwt')).expect(401)
  })

  it.each<[string, (i: Awaited<ReturnType<typeof createTestIssuer>>) => Promise<string>]>([
    ['vencido', (i) => i.sign({ expiresIn: -60 })],
    ['emisor (iss) distinto', (i) => i.sign({ issuer: 'https://otro.example/application/o/x/' })],
    ['audiencia (aud) distinta', (i) => i.sign({ audience: 'otra-aplicacion' })],
    ['firmado con OTRA clave', (i) => i.sign({ withOtherKey: true })],
    ['sin fecha de expiración', (i) => i.sign({ expiresIn: null })],
    ['sin sub', (i) => i.sign({ subject: null })],
    ['todavía no válido (nbf futuro)', (i) => i.sign({ notBefore: 3600 })],
    ['sin firma (alg: none)', async (i) => i.unsigned()],
    ['confusión de algoritmo (HS256)', (i) => i.algConfusion()],
  ])('token %s → 401 TOKEN_INVALID', async (_name, make) => {
    const issuer = await createTestIssuer()
    const server = await boot(issuer.keys)
    const res = await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await make(issuer)))
      .expect(401)
    expect(res.body.error.code).toBe('TOKEN_INVALID')
  })

  it('al cliente NO se le dice por qué falló: todas las causas dan la misma respuesta', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(issuer.keys)
    const bodies = await Promise.all(
      [issuer.sign({ expiresIn: -60 }), issuer.sign({ withOtherKey: true }), issuer.sign({ audience: 'x' })].map(
        async (token) =>
          (
            await request(server)
              .get('/api/v1/__authz/me')
              .set(bearer(await token))
          ).body.error,
      ),
    )
    for (const error of bodies)
      expect({ code: error.code, message: error.message }).toEqual({
        code: 'TOKEN_INVALID',
        message: 'Token ausente, inválido o vencido',
      })
    expect(bodies.every((e) => !('details' in e))).toBe(true)
  })

  it('el motivo real queda en el log (debug), no en la respuesta', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(issuer.keys)
    await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await issuer.sign({ expiresIn: -60 })))
    const rejected = logs.find((l) => l['msg'] === 'Token rechazado')
    expect(rejected).toMatchObject({ context: 'TokenVerifier', reason: 'ERR_JWT_EXPIRED' })
  })

  it('una clave desconocida (kid que no está en el JWKS) es un token inválido → 401', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(async () => {
      throw new errors.JWKSNoMatchingKey()
    })
    await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await issuer.sign()))
      .expect(401)
  })

  it('si NO se puede comprobar (Authentik/JWKS caído) es 502 UPSTREAM_UNAVAILABLE, no 401: no deslogueamos a todos', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(async () => {
      throw new TypeError('fetch failed')
    })
    const res = await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await issuer.sign()))
      .expect(502)
    expect(res.body.error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: { service: 'authentik' } })
    expect(JSON.stringify(res.body)).not.toContain('fetch failed')
  })

  it('un timeout del JWKS también es 502', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(async () => {
      throw new errors.JWKSTimeout()
    })
    await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await issuer.sign()))
      .expect(502)
  })
})

describe('rutas públicas', () => {
  it('no exigen token, y no hay usuario en el contexto', async () => {
    const server = await boot((await createTestIssuer()).keys)
    const res = await request(server).get('/api/v1/__authz/open').expect(200)
    expect(res.body.data).toEqual({ open: true, cls: null })
  })

  it('ni siquiera miran un token basura (no hay 401 en una ruta pública)', async () => {
    const server = await boot((await createTestIssuer()).keys)
    await request(server).get('/api/v1/__authz/open').set(bearer('basura')).expect(200)
    await request(server).get('/health/live').set(bearer('basura')).expect(200)
  })
})

describe('autorización: @Can según el rol', () => {
  const as = async (groups: string[]) => {
    const issuer = await createTestIssuer()
    return { server: await boot(issuer.keys), token: await issuer.sign({ claims: { groups } }) }
  }

  it('sin autenticar, una ruta con @Can responde 401 (no 403): primero quién eres', async () => {
    const server = await boot((await createTestIssuer()).keys)
    await request(server).get('/api/v1/__authz/audits').expect(401)
  })

  it('AUDITOR: lee auditorías (200) pero no crea plantillas (403 con acción y sujeto)', async () => {
    const { server, token } = await as(['auditor'])
    await request(server).get('/api/v1/__authz/audits').set(bearer(token)).expect(200)
    const res = await request(server).post('/api/v1/__authz/templates').set(bearer(token)).expect(403)
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', details: { action: 'create', subject: 'Template' } })
  })

  it('GERENTE: crea plantillas', async () => {
    const { server, token } = await as(['gerente'])
    await request(server).post('/api/v1/__authz/templates').set(bearer(token)).expect(201)
  })

  it('ADMIN: puede todo', async () => {
    const { server, token } = await as(['admin'])
    await request(server).get('/api/v1/__authz/audits').set(bearer(token)).expect(200)
    await request(server).post('/api/v1/__authz/templates').set(bearer(token)).expect(201)
  })

  it('sin ningún rol reconocido: 403 en todo lo protegido, pero @NoAbilityRequired funciona', async () => {
    const { server, token } = await as(['ventas'])
    await request(server).get('/api/v1/__authz/audits').set(bearer(token)).expect(403)
    await request(server).post('/api/v1/__authz/templates').set(bearer(token)).expect(403)
    await request(server).get('/api/v1/__authz/me').set(bearer(token)).expect(200)
  })

  it('varios roles suman permisos', async () => {
    const { server, token } = await as(['auditor', 'gerente'])
    await request(server).post('/api/v1/__authz/templates').set(bearer(token)).expect(201)
  })
})

describe('el log de acceso conoce al usuario solo si está autenticado', () => {
  it('incluye userId en una petición autenticada y no en una pública', async () => {
    const issuer = await createTestIssuer()
    const server = await boot(issuer.keys)
    await request(server)
      .get('/api/v1/__authz/me')
      .set(bearer(await issuer.sign()))
    await request(server).get('/api/v1/__authz/open')
    await new Promise((r) => setTimeout(r, 30))
    const access = logs.filter((l) => l['context'] === 'Http')
    expect(access.find((l) => l['path'] === '/api/v1/__authz/me')).toMatchObject({
      userId: '00000000-0000-7000-8000-00000000abcd',
    })
    expect(access.find((l) => l['path'] === '/api/v1/__authz/open')).not.toHaveProperty('userId')
  })
})
