import { defineErrors } from '../../platform/errors/index.js'

/**
 * No hay errores de "usuario desactivado" ni de "último administrador": la activación de cuentas la decide
 * Authentik (un token inválido es PlatformErrors.TOKEN_INVALID), y proteger al último ADMIN es lógica de la
 * sincronización (conserva el rol), no un fallo que se le muestre a alguien.
 */
export const IdentityErrors = defineErrors({
  USER_NOT_FOUND: { http: 404, message: 'Usuario no encontrado' },
  /**
   * El token es válido pero le faltan claims que el sistema necesita (`details.missing`: email y/o preferred_username).
   * Es un problema de configuración de Authentik (el scope `profile`/`email` del proveedor), no del usuario.
   */
  TOKEN_CLAIMS_MISSING: { http: 401, message: 'El token no incluye los datos de identidad necesarios' },
  /**
   * Otra petición creó o actualizó al mismo usuario (authentikId, email o username) al mismo tiempo. Es la carrera
   * normal de dos logins simultáneos: la sincronización con Authentik atrapa este código y reintenta.
   */
  USER_IDENTITY_CONFLICT: {
    http: 409,
    message: 'Otro proceso está sincronizando a este usuario; reintenta',
    onUnique: ['users_authentikId_key', 'users_email_key', 'users_username_key'],
  },
})
