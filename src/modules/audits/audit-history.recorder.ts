import { Injectable, type OnModuleInit } from '@nestjs/common'
import { InjectTx, type Tx } from '../../platform/db/index.js'
import { type DomainEvent, EventBus } from '../../platform/events/index.js'
import { AUDIT_EVENT_NAMES, type AuditEventPayload, subjectOf } from './domain/events.js'

/**
 * Único escritor de `audit_events`: se suscribe al bus y guarda cada evento de auditoría DENTRO de la transacción del caso de
 * uso que lo publicó (docs/02 §12). Si el caso de uso falla, el historial se revierte con él: nunca queda constancia de algo
 * que no ocurrió. Guarda el evento sin texto (`type` + `payload`); el mensaje se genera al leer.
 */
@Injectable()
export class AuditHistoryRecorder implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    @InjectTx() private readonly tx: Tx,
  ) {}

  onModuleInit(): void {
    this.bus.onAny((event) => this.record(event))
  }

  private async record(event: DomainEvent): Promise<void> {
    if (!AUDIT_EVENT_NAMES.has(event.name)) return // el bus lleva eventos de otros módulos
    const payload = event.payload as AuditEventPayload
    const subject = subjectOf(payload)
    await this.tx.auditEvent.create({
      data: {
        auditId: payload.auditId,
        type: event.name,
        actorId: event.actorId ?? null,
        targetUserId: payload.targetUserId ?? null,
        subjectType: subject.type,
        subjectId: subject.id,
        payload: payload as object,
        createdAt: event.occurredAt,
      },
    })
  }
}
