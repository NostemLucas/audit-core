import { Injectable, type OnModuleInit } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ClsService } from 'nestjs-cls'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DB, InjectTx, Transactional, type Db, type Tx } from '../../src/platform/db/index.js'
import { defineEvents, EventBus, type DomainEvent } from '../../src/platform/events/index.js'
import { createTestApp } from './support/app.js'
import { resetDb } from './support/db.js'

const DemoEvents = defineEvents({ OrganizationRegistered: z.object({ name: z.string() }) })

/** Un handler real: escribe en la BD a través de `@InjectTx()`, como lo hará el registrador del historial. */
@Injectable()
class DemoRecorder implements OnModuleInit {
  failNext = false
  readonly seen: DomainEvent[] = []

  constructor(
    private readonly bus: EventBus,
    @InjectTx() private readonly tx: Tx,
  ) {}

  onModuleInit(): void {
    this.bus.on(DemoEvents.OrganizationRegistered, async (event) => {
      this.seen.push(event)
      if (this.failNext) throw new Error('el handler falló')
      await this.tx.scale.create({ data: { name: `historial-${event.payload.name}` } })
    })
  }
}

@Injectable()
class DemoUseCase {
  constructor(
    private readonly bus: EventBus,
    @InjectTx() private readonly tx: Tx,
  ) {}

  @Transactional()
  async register(name: string, options: { failAfterPublish?: boolean } = {}): Promise<void> {
    await this.tx.organization.create({ data: { name } })
    await this.bus.publish(DemoEvents.OrganizationRegistered, { name })
    if (options.failAfterPublish) throw new Error('el caso de uso falló después de publicar')
  }

  /** Sin transacción: cada escritura se confirma sola. */
  async registerWithoutTransaction(name: string): Promise<void> {
    await this.tx.organization.create({ data: { name } })
    await this.bus.publish(DemoEvents.OrganizationRegistered, { name })
  }
}

let app: NestExpressApplication
let db: Db
let useCase: DemoUseCase
let recorder: DemoRecorder
let cls: ClsService

beforeAll(async () => {
  app = await createTestApp({ providers: [DemoRecorder, DemoUseCase] })
  db = app.get<Db>(DB)
  useCase = app.get(DemoUseCase)
  recorder = app.get(DemoRecorder)
  cls = app.get(ClsService)
})
afterAll(() => app.close())
beforeEach(async () => {
  await resetDb(db)
  recorder.failNext = false
  recorder.seen.length = 0
})

const inContext = <T>(work: () => Promise<T>) => cls.run(work)
const counts = async () => ({ orgs: await db.organization.count(), history: await db.scale.count() })

describe('los eventos se publican dentro de la transacción del caso de uso', () => {
  it('éxito: lo del caso de uso y lo que escribió el handler se confirman juntos', async () => {
    await inContext(() => useCase.register('ACME'))
    expect(await counts()).toEqual({ orgs: 1, history: 1 })
  })

  it('el caso de uso falla DESPUÉS de publicar: lo que escribió el handler se revierte con él', async () => {
    await expect(inContext(() => useCase.register('ACME', { failAfterPublish: true }))).rejects.toThrow('falló después de publicar')
    expect(recorder.seen).toHaveLength(1) // el handler sí se ejecutó...
    expect(await counts()).toEqual({ orgs: 0, history: 0 }) // ...pero su escritura no sobrevivió: era la misma transacción
  })

  it('el handler falla: el error llega al publicador y se revierte TODO, también lo del caso de uso', async () => {
    recorder.failNext = true
    await expect(inContext(() => useCase.register('ACME'))).rejects.toThrow('el handler falló')
    expect(await counts()).toEqual({ orgs: 0, history: 0 })
  })

  it('sin transacción no hay rollback: es el contraste que demuestra que arriba SÍ compartían transacción', async () => {
    recorder.failNext = true
    await expect(inContext(() => useCase.registerWithoutTransaction('ACME'))).rejects.toThrow('el handler falló')
    expect(await counts()).toEqual({ orgs: 1, history: 0 }) // la organización quedó: nada la revirtió
  })

  it('el evento lleva el usuario y el requestId de la petición', async () => {
    await inContext(async () => {
      cls.set('userId', '00000000-0000-7000-8000-0000000000aa')
      cls.set('requestId', 'trace-evt-12345')
      await useCase.register('ACME')
    })
    expect(recorder.seen[0]).toMatchObject({
      name: 'OrganizationRegistered',
      payload: { name: 'ACME' },
      actorId: '00000000-0000-7000-8000-0000000000aa',
      requestId: 'trace-evt-12345',
    })
  })

  it('publicar un payload inválido no ejecuta handlers ni deja escrituras', async () => {
    await expect(
      inContext(async () => {
        const bus = app.get(EventBus)
        await bus.publish(DemoEvents.OrganizationRegistered, { name: 123 } as never)
      }),
    ).rejects.toThrow(/Payload inválido/)
    expect(recorder.seen).toHaveLength(0)
    expect(await counts()).toEqual({ orgs: 0, history: 0 })
  })
})
