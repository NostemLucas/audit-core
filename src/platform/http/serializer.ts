import { StandardSchemaSerializerInterceptor } from '@nestjs/common'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Page } from './page.js'

/**
 * Serializa la respuesta con el esquema declarado en `@SerializeOptions({ schema })` (nativo de Nest 12):
 * recorta los campos no declarados y garantiza que lo que sale es lo que documenta el OpenAPI. Si la respuesta
 * no cumple su esquema es un bug nuestro: se lanza y el filtro responde INTERNAL (500), sin filtrar el detalle.
 *
 * Único añadido a la versión nativa: un `Page` se serializa ítem por ítem y conserva su `meta`.
 * Se registra DENTRO del `EnvelopeInterceptor` para que este envuelva lo ya serializado.
 */
export class ApiSerializerInterceptor extends StandardSchemaSerializerInterceptor {
  override serialize(
    response: Parameters<StandardSchemaSerializerInterceptor['serialize']>[0],
    schema: StandardSchemaV1 | undefined,
    validateOptions?: StandardSchemaV1.Options,
  ): ReturnType<StandardSchemaSerializerInterceptor['serialize']> {
    if (response instanceof Page) {
      return Promise.resolve(super.serialize([...response.items], schema, validateOptions)).then(
        (items) => new Page(items as unknown[], response.meta) as never,
      )
    }
    return super.serialize(response, schema, validateOptions)
  }
}
