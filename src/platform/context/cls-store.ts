import 'nestjs-cls'

declare module 'nestjs-cls' {
  interface ClsStore {
    /** Id de la petición (mismo valor que `x-request-id` y el `traceId` de los errores). */
    requestId?: string
    /** Usuario autenticado. Lo fija el guard de autenticación; sin él (seeds, jobs) los sellos quedan en null. */
    userId?: string
  }
}
