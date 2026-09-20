import { Prisma } from '../../generated/prisma/client.js'
import { translateDbError } from './translate-db-error.js'

/**
 * Modelos con sellos `createdById` / `updatedById`. Se deduce del schema (`<Modelo>ScalarFieldEnum`), no de una
 * lista escrita a mano: agregar los sellos a un modelo en `schema.prisma` basta.
 */
const STAMPED_MODELS: ReadonlySet<string> = new Set(
  Object.values(Prisma.ModelName).filter((model) => {
    const fields = (Prisma as unknown as Record<string, Record<string, string> | undefined>)[`${model}ScalarFieldEnum`]
    return fields !== undefined && 'createdById' in fields
  }),
)

type Data = Record<string, unknown>
const stampCreate = (data: Data, userId: string | null): Data => ({ createdById: userId, updatedById: userId, ...data })
const stampUpdate = (data: Data, userId: string | null): Data => ({ updatedById: userId, ...data })

/**
 * Rellena `createdById` / `updatedById` con el usuario de la petición (CLS). Sin usuario (seeds, jobs) quedan en
 * null. Un valor explícito del llamador gana. Alcance: la operación de nivel superior; una escritura anidada
 * (`create` dentro de `create`) NO se sella.
 */
export function stampsExtension(getUserId: () => string | undefined) {
  return Prisma.defineExtension({
    name: 'stamps',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!STAMPED_MODELS.has(model)) return query(args)
          const userId = getUserId() ?? null
          const a = args as { data?: Data | Data[]; create?: Data; update?: Data }

          switch (operation) {
            case 'create':
              a.data = stampCreate(a.data as Data, userId)
              break
            case 'createMany':
            case 'createManyAndReturn':
              a.data = Array.isArray(a.data)
                ? a.data.map((row) => stampCreate(row, userId))
                : stampCreate(a.data as Data, userId)
              break
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
              a.data = stampUpdate(a.data as Data, userId)
              break
            case 'upsert':
              a.create = stampCreate(a.create as Data, userId)
              a.update = stampUpdate(a.update as Data, userId)
              break
          }
          return query(a as typeof args)
        },
      },
    },
  })
}

/** Convierte los errores de la BD en errores del catálogo, sabiendo qué operación los provocó. */
export const errorTranslationExtension = Prisma.defineExtension({
  name: 'error-translation',
  query: {
    $allModels: {
      async $allOperations({ operation, args, query }) {
        try {
          return await query(args)
        } catch (error) {
          throw translateDbError(error, operation)
        }
      },
    },
  },
})
