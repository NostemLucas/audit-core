import 'nestjs-cls'

declare module 'nestjs-cls' {
  interface ClsStore {
    /**
     * Id que enlaza todo lo ocurrido en una misma unidad de trabajo: logs, eventos, errores. Lo fija el PUNTO DE ENTRADA:
     * en HTTP es el `x-request-id`; en un job o un seed lo genera `ContextRunner`. Por eso no se llama `requestId`:
     * fuera de HTTP no hay petición.
     */
    correlationId?: string
    /** Usuario autenticado. Lo fija el guard de autenticación; sin él (seeds, jobs) los sellos quedan en null. */
    userId?: string
  }
}
