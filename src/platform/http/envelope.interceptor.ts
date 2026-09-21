import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common'
import { map, type Observable } from 'rxjs'
import { Page } from './page.js'

/**
 * Único formato de éxito del API: `{ data }`, o `{ data, meta }` si el controller devolvió un `Page`.
 * Un archivo (`StreamableFile`) no se envuelve: es el cuerpo de la respuesta tal cual.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof StreamableFile) return value
        return value instanceof Page ? { data: value.items, meta: value.meta } : { data: value ?? null }
      }),
    )
  }
}
