import { DomainError } from '../../../platform/errors/index.js'

/**
 * Dos primeros logins simultáneos del mismo usuario chocan en un índice único (authentikId / email / username): el
 * perdedor ve `USER_IDENTITY_CONFLICT`. No es un error real: al reintentar, el usuario ya existe y se lee. Se reintenta
 * UNA sola vez; si el conflicto persiste es real (otra cuenta ya usa ese email o username) y se propaga.
 * Cualquier otro error no se reintenta.
 */
export async function retryOnceOnIdentityConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof DomainError && error.code === 'USER_IDENTITY_CONFLICT') return work()
    throw error
  }
}
