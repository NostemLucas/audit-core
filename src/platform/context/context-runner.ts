import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import './cls-store.js'

/**
 * Abre un contexto ambiental NUEVO para un punto de entrada que no es HTTP (job programado, seed, comando). Fija
 * un `correlationId` (`<entrada>:<uuid>`) para que sus logs, eventos y errores queden enlazados igual que los de una
 * petición. En HTTP no se usa: el middleware ya abre el contexto con el `x-request-id`.
 *
 * `ifNested: 'override'` a propósito: un punto de entrada es una unidad de trabajo nueva, no hereda la anterior.
 */
@Injectable()
export class ContextRunner {
  constructor(private readonly cls: ClsService) {}

  run<T>(entrypoint: string, work: () => Promise<T>, initial: { userId?: string } = {}): Promise<T> {
    return this.cls.run({ ifNested: 'override' }, async () => {
      this.cls.set('correlationId', `${entrypoint}:${randomUUID()}`)
      if (initial.userId) this.cls.set('userId', initial.userId)
      return work()
    })
  }
}
