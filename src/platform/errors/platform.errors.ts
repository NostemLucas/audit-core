import { defineErrors } from './define-errors.js'

/** Errores genéricos que no pertenecen a ningún módulo de negocio. */
export const PlatformErrors = defineErrors({
  VALIDATION_FAILED: { http: 400, message: 'Los datos enviados no son válidos' },
  TOKEN_INVALID: { http: 401, message: 'Token ausente, inválido o vencido' },
  FORBIDDEN: { http: 403, message: 'No tienes permiso para realizar esta acción' },
  NOT_FOUND: { http: 404, message: 'El recurso no existe' },
  PAYLOAD_TOO_LARGE: { http: 413, message: 'El archivo o el cuerpo de la petición es demasiado grande' },
  CONFLICT: { http: 409, message: 'La operación entra en conflicto con el estado actual' },
  /** Bloqueo optimista: alguien modificó el registro después de que lo leíste. */
  VERSION_CONFLICT: { http: 409, message: 'El registro fue modificado por otra persona; vuelve a cargarlo' },
  /** Un create/update violó una FK: el id referenciado no existe. Los casos conocidos se validan antes con errores propios. */
  REFERENCE_INVALID: { http: 422, message: 'Se referencia un registro que no existe' },
  /** Un CHECK de la BD rechazó los datos: red de seguridad; el dominio valida antes con errores específicos. */
  INTEGRITY_VIOLATION: { http: 422, message: 'Los datos violan una regla de integridad' },
  RATE_LIMITED: { http: 429, message: 'Demasiadas solicitudes; intenta más tarde' },
  UPSTREAM_UNAVAILABLE: { http: 502, message: 'Un servicio externo no está disponible' },
  WEBHOOK_SIGNATURE_INVALID: { http: 401, message: 'Firma del webhook inválida' },
  /** Readiness: una dependencia obligatoria (la base de datos) no responde. */
  SERVICE_UNAVAILABLE: { http: 503, message: 'El servicio no está listo' },
  INTERNAL: { http: 500, message: 'Error interno' },
})
