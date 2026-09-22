import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { errorTranslationExtension, stampsExtension, versionExtension } from './extensions.js'

/** Cliente de base de datos ya extendido: sellos de auditoría + versión (bloqueo optimista) + traducción de errores. */
export function createDb(connectionString: string, getUserId: () => string | undefined) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
    .$extends(stampsExtension(getUserId))
    .$extends(versionExtension)
    .$extends(errorTranslationExtension)
}

export type Db = ReturnType<typeof createDb>
