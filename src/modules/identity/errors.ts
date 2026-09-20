import { defineErrors } from '../../platform/errors'

/**
 * No hay errores de "usuario desactivado" ni de "último administrador": la activación de cuentas la decide
 * Authentik (un token inválido es PlatformErrors.TOKEN_INVALID), y proteger al último ADMIN es lógica de la
 * sincronización (conserva el rol), no un fallo que se le muestre a alguien.
 */
export const IdentityErrors = defineErrors({
  USER_NOT_FOUND: { http: 404, message: 'Usuario no encontrado' },
})
