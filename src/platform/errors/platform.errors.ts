import { defineErrors } from './define-errors.js'

/** Errores genéricos que no pertenecen a ningún módulo de negocio. */
export const PlatformErrors = defineErrors({
  VALIDATION_FAILED: { http: 400, message: 'Los datos enviados no son válidos' },
  TOKEN_INVALID: { http: 401, message: 'Token ausente, inválido o vencido' },
  FORBIDDEN: { http: 403, message: 'No tienes permiso para realizar esta acción' },
  NOT_FOUND: { http: 404, message: 'El recurso no existe' },
  CONFLICT: { http: 409, message: 'La operación entra en conflicto con el estado actual' },
  /** Bloqueo optimista: alguien modificó el registro después de que lo leíste. */
  VERSION_CONFLICT: { http: 409, message: 'El registro fue modificado por otra persona; vuelve a cargarlo' },
  /** Un create/update violó una FK: el id referenciado no existe. Los casos conocidos se validan antes con errores propios. */
  REFERENCE_INVALID: { http: 422, message: 'Se referencia un registro que no existe' },
  RATE_LIMITED: { http: 429, message: 'Demasiadas solicitudes; intenta más tarde' },
  UPSTREAM_UNAVAILABLE: { http: 502, message: 'Un servicio externo no está disponible' },
  WEBHOOK_SIGNATURE_INVALID: { http: 401, message: 'Firma del webhook inválida' },
  INTERNAL: { http: 500, message: 'Error interno' },
})
