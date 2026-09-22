import { DomainError, PlatformErrors } from '../errors/index.js'

/**
 * Bloqueo optimista, mitad de cada caso de uso: la escritura va con `where: { id, version }` y, si no tocó ninguna fila,
 * alguien la cambió después de que el cliente la leyó. La otra mitad (incrementar `version` en cada escritura) es la
 * extensión `versionExtension`. Sin bloqueos de fila: quien llega tarde recibe 409 y vuelve a cargar.
 */
export function versionConflict(entity: string, id: string, expected: number): DomainError {
  return new DomainError(PlatformErrors.VERSION_CONFLICT, { entity, id, expected })
}
