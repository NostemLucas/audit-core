import { type ExecutionContext, Controller, Get, Post } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { ENV } from '../src/platform/config/index.js'
import { AbilitiesGuard, Can, NoAbilityRequired, Public, listRoutes } from '../src/platform/authz/index.js'
import { DomainError } from '../src/platform/errors/index.js'
import { testEnv } from './support/env.js'

@Controller('__forgotten')
class ForgottenController {
  @Get('a')
  forgotten() {
    return 1
  }

  @Get('b')
  @Public()
  declared() {
    return 1
  }

  @Post('c')
  alsoForgotten() {
    return 1
  }
}

@Public()
@Controller('__class-level')
class ClassLevelController {
  @Get('inherits')
  inherits() {
    return 1
  }

  @Get('overrides')
  @Can('read', 'Audit')
  overrides() {
    return 1
  }
}

const compile = (controllers: unknown[] = []) =>
  Test.createTestingModule({ imports: [AppModule], controllers: controllers as never[] })
    .overrideProvider(ENV)
    .useValue(testEnv())
    .compile()

let app: Awaited<ReturnType<Awaited<ReturnType<typeof compile>>['createNestApplication']>> | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('la aplicación NO arranca con una ruta sin acceso declarado', () => {
  it('el arranque falla y lista cada ruta olvidada con su método, ruta y handler', async () => {
    const moduleRef = await compile([ForgottenController])
    app = moduleRef.createNestApplication({ logger: false })
    const failure = await app.init().then(
      () => undefined,
      (error: unknown) => error as Error,
    )
    expect(failure).toBeDefined()
    expect(failure?.message).toMatch(/Rutas sin acceso declarado/)
    expect(failure?.message).toContain('GET /__forgotten/a  (ForgottenController.forgotten)')
    expect(failure?.message).toContain('POST /__forgotten/c  (ForgottenController.alsoForgotten)')
    expect(failure?.message).not.toContain('declared') // la que sí declara no aparece
    app = undefined
  })

  it('con todas las rutas declaradas arranca', async () => {
    const moduleRef = await compile([ClassLevelController])
    app = moduleRef.createNestApplication({ logger: false })
    await expect(app.init()).resolves.toBeDefined()
  })

  it('las rutas REALES del sistema están todas declaradas', async () => {
    const moduleRef = await compile()
    app = moduleRef.createNestApplication({ logger: false })
    await app.init()
    const routes = listRoutes(app.get(DiscoveryService), app.get(MetadataScanner), app.get(Reflector))
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.filter((r) => r.access === undefined)).toEqual([])
    const byHandler = Object.fromEntries(routes.map((r) => [r.handler, r.access?.kind]))
    expect(byHandler['HealthController.live']).toBe('public')
    expect(byHandler['HealthController.ready']).toBe('public')
    expect(byHandler['ProfileController.get']).toBe('no-ability-required')
  })
})

describe('qué declara una ruta', () => {
  it('lo declarado en la clase lo heredan sus métodos; el método gana sobre la clase', async () => {
    const moduleRef = await compile([ClassLevelController])
    app = moduleRef.createNestApplication({ logger: false })
    await app.init()
    const routes = listRoutes(app.get(DiscoveryService), app.get(MetadataScanner), app.get(Reflector))
    const kind = (handler: string) => routes.find((r) => r.handler === handler)?.access
    expect(kind('ClassLevelController.inherits')).toEqual({ kind: 'public' })
    expect(kind('ClassLevelController.overrides')).toEqual({ kind: 'can', action: 'read', subject: 'Audit' })
  })

  it('declarar acceso DOS veces falla al decorar, en lugar de que una sobrescriba a la otra en silencio', () => {
    expect(() => {
      class Twice {
        @Public()
        @Can('read', 'Audit')
        method() {}
      }
      return Twice
    }).toThrow(/declara acceso más de una vez/)
  })

  it('también en una clase', () => {
    expect(() => {
      @Public()
      @NoAbilityRequired()
      class TwiceOnClass {}
      return TwiceOnClass
    }).toThrow(/más de una vez/)
  })
})

describe('AbilitiesGuard falla CERRADO', () => {
  const contextFor = (handler: () => void, klass: new () => unknown, user?: { roles: string[] }) =>
    ({
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext

  class Bare {
    method() {}
  }

  it('una ruta sin acceso declarado se rechaza (FORBIDDEN), aunque el arranque ya lo impide', () => {
    const guard = new AbilitiesGuard(new Reflector())
    expect(() => guard.canActivate(contextFor(Bare.prototype.method, Bare, { roles: ['ADMIN'] }))).toThrow(DomainError)
    try {
      guard.canActivate(contextFor(Bare.prototype.method, Bare, { roles: ['ADMIN'] }))
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'ruta sin acceso declarado' } })
    }
  })

  it('un @Can sin usuario en la petición se rechaza', () => {
    class Guarded {
      @Can('read', 'Audit')
      method() {}
    }
    const guard = new AbilitiesGuard(new Reflector())
    expect(() => guard.canActivate(contextFor(Guarded.prototype.method, Guarded))).toThrow(DomainError)
  })
})
