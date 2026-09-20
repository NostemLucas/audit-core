import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineEvents } from './define-events.js'
import { defineMessages, eventsWithoutMessage, renderEventMessage } from './define-messages.js'

const Events = defineEvents({
  MsgMemberAssigned: z.object({ member: z.string(), role: z.enum(['LEAD', 'INSPECTOR']) }),
  MsgAuditClosed: z.object({ code: z.string() }),
})

defineMessages(Events, {
  MsgMemberAssigned: (p) => `Asignó a ${p.member} como ${p.role === 'LEAD' ? 'auditor líder' : 'inspector'}`,
  MsgAuditClosed: (p) => `Cerró la auditoría ${p.code}`,
})

describe('mensajes de eventos', () => {
  it('genera el texto al leer, a partir del tipo y el payload guardados', () => {
    expect(renderEventMessage('MsgMemberAssigned', { member: 'Ana', role: 'LEAD' })).toBe(
      'Asignó a Ana como auditor líder',
    )
    expect(renderEventMessage('MsgAuditClosed', { code: 'AUD-1' })).toBe('Cerró la auditoría AUD-1')
  })

  it('una fila de un evento que ya no existe devuelve undefined en vez de romper el historial', () => {
    expect(renderEventMessage('EventoBorradoHaceAnios', { x: 1 })).toBeUndefined()
  })

  it('un payload antiguo que ya no cumple el esquema devuelve undefined', () => {
    expect(renderEventMessage('MsgMemberAssigned', { member: 'Ana' })).toBeUndefined()
  })

  it('un evento sin mensaje se detecta (lo usa el test del catálogo)', () => {
    defineEvents({ MsgOrphanEvent: z.object({}) })
    expect(eventsWithoutMessage()).toContain('MsgOrphanEvent')
    expect(eventsWithoutMessage()).not.toContain('MsgAuditClosed')
  })

  it('no permite registrar dos veces el mensaje de un evento', () => {
    expect(() => defineMessages(Events, { MsgMemberAssigned: () => 'x', MsgAuditClosed: () => 'y' })).toThrow(
      /Ya hay un mensaje/,
    )
  })

  it('un mapa incompleto no compila (exhaustividad)', () => {
    // Lo comprueba `tsc --noEmit`: si `@ts-expect-error` no viese error, el typecheck fallaría.
    const build = () =>
      defineMessages(
        defineEvents({ MsgOnlyOne: z.object({}), MsgOtherOne: z.object({}) }),
        // @ts-expect-error falta el mensaje de MsgOtherOne
        { MsgOnlyOne: () => 'uno' },
      )
    expect(typeof build).toBe('function')
  })
})
