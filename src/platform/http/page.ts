/** Metadatos de paginación: lo único que va en `meta` de una respuesta. */
export interface PageMeta {
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly totalPages: number
}

/** Marca una lista paginada para que el interceptor la envuelva como `{ data: items, meta }`. */
export class Page<T> {
  constructor(
    readonly items: readonly T[],
    readonly meta: PageMeta,
  ) {}
}

export function page<T>(items: readonly T[], input: { page: number; pageSize: number; total: number }): Page<T> {
  return new Page(items, { ...input, totalPages: Math.max(1, Math.ceil(input.total / input.pageSize)) })
}
