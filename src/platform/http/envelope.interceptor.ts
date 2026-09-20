import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import { map, type Observable } from 'rxjs'
import { Page } from './page.js'

/** Único formato de éxito del API: `{ data }`, o `{ data, meta }` si el controller devolvió un `Page`. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(map((value) => (value instanceof Page ? { data: value.items, meta: value.meta } : { data: value ?? null })))
  }
}
