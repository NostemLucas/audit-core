import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { useTestApi } from './support/api.js'
import { type SeedNode, seedControls } from './support/templates.js'

const T = '/api/v1/templates'
const YAML_MIME = 'application/yaml'
const UNKNOWN_ID = '0199c0de-0000-7000-8000-000000000001'

const t = useTestApi()
const { api, as, db } = t

async function createTemplate(name = 'ISO/IEC 27001:2022'): Promise<string> {
  const res = await api()
    .post(T)
    .set('authorization', await as('manager'))
    .send({ name })
  return res.body.data.id
}
async function templateWith(spec: readonly SeedNode[], name?: string): Promise<string> {
  const id = await createTemplate(name)
  await seedControls(db, id, spec)
  return id
}
const VALID: SeedNode[] = [{ title: 'Dominio', kids: [{ title: 'Criterio' }] }]
const post = async (path: string, role: 'manager' | 'auditor' = 'manager') =>
  api()
    .post(path)
    .set('authorization', await as(role))

describe('publicar', () => {
  it('una plantilla válida pasa a PUBLISHED y solo admite archivar; ya no se puede editar', async () => {
    const id = await templateWith(VALID)
    const res = await post(`${T}/${id}/publish`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id, status: 'PUBLISHED', allowedActions: ['ARCHIVE'], controlCount: 2 })
    const edit = await api()
      .post(`${T}/${id}/controls`)
      .set('authorization', await as('manager'))
      .send({ title: 'tarde' })
    expect(edit.body.error.code).toBe('TEMPLATE_NOT_EDITABLE')
  })

  it('vacía: 422 TEMPLATE_EMPTY y sigue en borrador', async () => {
    const id = await createTemplate()
    const res = await post(`${T}/${id}/publish`)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_EMPTY')
    expect((await db.template.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT')
  })

  it('con dominios sin hijos: 422 TEMPLATE_INVALID_STRUCTURE con la lista exacta de los que fallan; al agrupar, se publica', async () => {
    const id = await templateWith([
      { title: 'Con hijos', kids: [{ title: 'h' }] },
      { title: 'Sola 1' },
      { title: 'Sola 2' },
    ])
    const res = await post(`${T}/${id}/publish`)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_INVALID_STRUCTURE')
    expect(res.body.error.details.roots.map((r: { title: string }) => r.title)).toEqual(['Sola 1', 'Sola 2'])
    expect((await db.template.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT')

    const solo = await db.control.findFirstOrThrow({ where: { templateId: id, title: 'Sola 1' } })
    await api()
      .post(`${T}/${id}/controls`)
      .set('authorization', await as('manager'))
      .send({ title: 'agrupado', parentId: solo.id })
      .expect(201)
    const second = await db.control.findFirstOrThrow({ where: { templateId: id, title: 'Sola 2' } })
    await api()
      .post(`${T}/${id}/controls`)
      .set('authorization', await as('manager'))
      .send({ title: 'otro', parentId: second.id })
      .expect(201)
    expect((await post(`${T}/${id}/publish`)).status).toBe(200)
  })

  it('una plantilla plana (todo a primer nivel) no se publica: no hay dominios', async () => {
    const id = await templateWith([{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    const res = await post(`${T}/${id}/publish`)
    expect(res.body.error.code).toBe('TEMPLATE_INVALID_STRUCTURE')
    expect(res.body.error.details.roots).toHaveLength(3)
  })

  it('publicar dos veces o una archivada: 409 TEMPLATE_INVALID_STATE con el estado y el evento', async () => {
    const id = await templateWith(VALID)
    await post(`${T}/${id}/publish`).then((r) => expect(r.status).toBe(200))
    const twice = await post(`${T}/${id}/publish`)
    expect(twice.status).toBe(409)
    expect(twice.body.error).toMatchObject({
      code: 'TEMPLATE_INVALID_STATE',
      details: { from: 'PUBLISHED', event: 'PUBLISH' },
    })
    await db.template.update({ where: { id }, data: { status: 'ARCHIVED' } })
    expect((await post(`${T}/${id}/publish`)).body.error.details).toMatchObject({ from: 'ARCHIVED' })
  })

  it('el ciclo de vida gana a las precondiciones: una publicada VACÍA da INVALID_STATE, no TEMPLATE_EMPTY', async () => {
    const id = await createTemplate()
    await db.template.update({ where: { id }, data: { status: 'PUBLISHED' } })
    expect((await post(`${T}/${id}/publish`)).body.error.code).toBe('TEMPLATE_INVALID_STATE')
  })

  it('un auditor no publica (403); plantilla inexistente 404', async () => {
    const id = await templateWith(VALID)
    expect((await post(`${T}/${id}/publish`, 'auditor')).status).toBe(403)
    expect((await post(`${T}/${UNKNOWN_ID}/publish`)).status).toBe(404)
    expect((await db.template.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT')
  })
})

describe('archivar', () => {
  it('PUBLISHED → ARCHIVED (estado final, sin acciones); desde borrador o archivada: 409', async () => {
    const id = await templateWith(VALID)
    const early = await post(`${T}/${id}/archive`)
    expect(early.status).toBe(409)
    expect(early.body.error).toMatchObject({
      code: 'TEMPLATE_INVALID_STATE',
      details: { from: 'DRAFT', event: 'ARCHIVE' },
    })

    await post(`${T}/${id}/publish`)
    const res = await post(`${T}/${id}/archive`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'ARCHIVED', allowedActions: [] })
    expect((await post(`${T}/${id}/archive`)).status).toBe(409)
  })

  it('permisos y 404', async () => {
    const id = await templateWith(VALID)
    await post(`${T}/${id}/publish`)
    expect((await post(`${T}/${id}/archive`, 'auditor')).status).toBe(403)
    expect((await post(`${T}/${UNKNOWN_ID}/archive`)).status).toBe(404)
  })

  it('una archivada sigue siendo legible y se puede exportar', async () => {
    const id = await templateWith(VALID)
    await post(`${T}/${id}/publish`)
    await post(`${T}/${id}/archive`)
    const auth = await as('auditor')
    await api().get(`${T}/${id}`).set('authorization', auth).expect(200)
    await api().get(`${T}/${id}/controls`).set('authorization', auth).expect(200)
    await api().get(`${T}/${id}/export`).set('authorization', auth).expect(200)
  })
})
// ── YAML ─────────────────────────────────────────────────────────────────────────────────────────────────────
const yamlFile = (doc: Record<string, unknown>): Buffer => Buffer.from(stringifyYaml(doc), 'utf8')

async function upload(
  file: Buffer | undefined,
  fields: Record<string, string> = {},
  role: 'manager' | 'auditor' = 'manager',
) {
  let req = api()
    .post(`${T}/import`)
    .set('authorization', await as(role))
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value)
  if (file) req = req.attach('file', file, { filename: 'plantilla.yaml', contentType: YAML_MIME })
  return req
}
async function download(id: string, role: 'manager' | 'auditor' = 'manager') {
  return api()
    .get(`${T}/${id}/export`)
    .set('authorization', await as(role))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
}
type View = {
  id: string
  parentId: string | null
  reference: string | null
  title: string
  description: string | null
  position: number
  depth: number
  isLeaf: boolean
}
const shape = async (templateId: string) =>
  (
    (
      await api()
        .get(`${T}/${templateId}/controls`)
        .set('authorization', await as('manager'))
    ).body.data as View[]
  ).map(({ reference, title, description, position, depth, isLeaf }) => ({
    reference,
    title,
    description,
    position,
    depth,
    isLeaf,
  }))

describe('importar', () => {
  const ISO = {
    controls: [
      {
        reference: 'A.5',
        title: 'Controles organizacionales',
        description: 'Descripción del tema',
        controls: [
          { reference: 'A.5.1', title: 'Políticas para la seguridad de la información' },
          { reference: 'A.5.2', title: '¿Están definidos los roles y responsabilidades?' },
        ],
      },
      {
        reference: 'A.6',
        title: 'Controles de personas',
        controls: [{ reference: 'A.6.1', title: 'Selección', controls: [{ title: 'Verificación de antecedentes' }] }],
      },
    ],
  }

  it('crea una plantilla NUEVA en borrador con el árbol del archivo (la anidación es la jerarquía, orden de lectura)', async () => {
    const res = await upload(yamlFile(ISO), { name: 'ISO/IEC 27001:2022' })
    expect(res.status).toBe(201)
    expect(res.body.data.template).toMatchObject({
      name: 'ISO/IEC 27001:2022',
      status: 'DRAFT',
      controlCount: 6,
      allowedActions: ['PUBLISH'],
    })
    expect(await shape(res.body.data.template.id)).toEqual([
      {
        reference: 'A.5',
        title: 'Controles organizacionales',
        description: 'Descripción del tema',
        position: 0,
        depth: 0,
        isLeaf: false,
      },
      {
        reference: 'A.5.1',
        title: 'Políticas para la seguridad de la información',
        description: null,
        position: 0,
        depth: 1,
        isLeaf: true,
      },
      {
        reference: 'A.5.2',
        title: '¿Están definidos los roles y responsabilidades?',
        description: null,
        position: 1,
        depth: 1,
        isLeaf: true,
      },
      { reference: 'A.6', title: 'Controles de personas', description: null, position: 1, depth: 0, isLeaf: false },
      { reference: 'A.6.1', title: 'Selección', description: null, position: 0, depth: 1, isLeaf: false },
      {
        reference: null,
        title: 'Verificación de antecedentes',
        description: null,
        position: 0,
        depth: 2,
        isLeaf: true,
      },
    ])
    const row = await db.template.findUniqueOrThrow({ where: { id: res.body.data.template.id } })
    const user = await db.user.findUniqueOrThrow({ where: { authentikId: 'sub-manager' } })
    expect(row.createdById).toBe(user.id)
  })

  it('el nombre viene del campo o de la clave "name" del YAML; si vienen los dos gana el campo; si no viene ninguno: 422', async () => {
    const withName = { name: 'Del archivo', controls: [{ title: 'D', controls: [{ title: 'h' }] }] }
    expect((await upload(yamlFile(withName))).body.data.template.name).toBe('Del archivo')
    expect((await upload(yamlFile(withName), { name: 'Del formulario' })).body.data.template.name).toBe(
      'Del formulario',
    )

    const anonymous = await upload(yamlFile({ controls: withName.controls }))
    expect(anonymous.status).toBe(422)
    expect(anonymous.body.error.code).toBe('TEMPLATE_IMPORT_INVALID')
    expect(anonymous.body.error.details.errors[0].message).toMatch(/nombre/)
  })

  it('errores del archivo: 422 con la posición de cada uno (orden de lectura), y NO se crea nada', async () => {
    const res = await upload(
      yamlFile({
        controls: [{ title: 'ok' }, { title: '', controls: [{ title: 'nieto ok' }] }, { title: '' }],
      }),
      { name: 'Con errores' },
    )
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_IMPORT_INVALID')
    expect(res.body.error.details.errors.map((e: { row: number }) => e.row)).toEqual([2, 4])
    expect(res.body.error.details.totalErrors).toBe(2)
    expect(await db.template.count()).toBe(0)
    expect(await db.control.count()).toBe(0)
  })

  it('con muchos errores se informan los primeros 20 y el total', async () => {
    const controls = Array.from({ length: 30 }, () => ({ title: '' }))
    const res = await upload(yamlFile({ controls }), { name: 'Muchos' })
    expect(res.body.error.details.errors).toHaveLength(20)
    expect(res.body.error.details.totalErrors).toBe(30)
  })

  it('nombre repetido (sin distinguir mayúsculas): 409 y no queda ningún control huérfano', async () => {
    await createTemplate('Existente')
    const res = await upload(yamlFile({ controls: [{ title: 'D', controls: [{ title: 'h' }] }] }), {
      name: 'existente',
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TEMPLATE_NAME_TAKEN')
    expect(await db.template.count()).toBe(1)
    expect(await db.control.count()).toBe(0)
  })

  it.each([
    ['sin archivo', undefined],
    ['un archivo que no es YAML', Buffer.from('controls: [x: y: z\n', 'utf8')],
    ['un archivo sin ningún control', Buffer.from('name: X\n', 'utf8')],
  ])('%s: 422 TEMPLATE_IMPORT_INVALID', async (_caso, file) => {
    const res = await upload(file, { name: 'X' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TEMPLATE_IMPORT_INVALID')
    expect(await db.template.count()).toBe(0)
  })

  it('una petición sin cuerpo ni archivo: 422 "Falta el archivo" (igual que con campos pero sin archivo)', async () => {
    const res = await api()
      .post(`${T}/import`)
      .set('authorization', await as('manager'))
    expect(res.status).toBe(422)
    expect(res.body.error.details.errors[0].message).toMatch(/Falta el archivo/)
  })

  it('un archivo de más de 5 MB: 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await upload(Buffer.alloc(5 * 1024 * 1024 + 1024, 'a'), { name: 'Enorme' })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(await db.template.count()).toBe(0)
  })

  it('un archivo en el tope de 5000 controles se importa completo (la inserción cabe en los límites de parámetros de Postgres)', async () => {
    const domains = Array.from({ length: 50 }, (_v, d) => ({
      title: `Dominio ${d}`,
      controls: Array.from({ length: 99 }, (_w, c) => ({ title: `Criterio ${d}.${c}`, description: 'descripción' })),
    }))
    const total = domains.reduce((sum, d) => sum + 1 + d.controls.length, 0)
    expect(total).toBe(5000)
    const res = await upload(yamlFile({ controls: domains }), { name: 'En el tope' })
    expect(res.status).toBe(201)
    expect(res.body.data.template.controlCount).toBe(5000)
    expect(await db.control.count({ where: { parentId: null } })).toBe(50)

    const over = await upload(yamlFile({ controls: [...domains, { title: 'una más' }] }), { name: 'Pasado' })
    expect(over.status).toBe(422)
    expect(over.body.error.details.errors[0].message).toMatch(/máximo de 5000/)
  })

  it('un auditor no importa (403 antes de leer el archivo); sin token 401', async () => {
    const file = yamlFile({ controls: [{ title: 'D' }] })
    expect((await upload(file, { name: 'X' }, 'auditor')).status).toBe(403)
    expect((await api().post(`${T}/import`).attach('file', file, 'x.yaml')).status).toBe(401)
    expect(await db.template.count()).toBe(0)
  })

  /**
   * Atomicidad: si el guardado de los controles falla DESPUÉS de crear la plantilla, no debe quedar la plantilla. El fallo
   * se provoca con un disparador temporal de la BD (cualquier error de la BD sirve).
   */
  it('si falla el guardado de los controles, no queda la plantilla a medias (transacción)', async () => {
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_control() RETURNS trigger AS $$
      BEGIN IF NEW."title" = 'BOOM' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_control BEFORE INSERT ON "controls" FOR EACH ROW EXECUTE FUNCTION test_fail_control()`,
    )
    try {
      const file = yamlFile({ controls: [{ title: 'Dominio', controls: [{ title: 'BOOM' }] }] })
      const res = await upload(file, { name: 'Se rompe' })
      expect(res.status).toBe(500)
      expect(res.body.error.code).toBe('INTERNAL')
      expect(await db.template.count()).toBe(0)
      expect(await db.control.count()).toBe(0)
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_fail_control ON "controls"')
      await db.$executeRawUnsafe('DROP FUNCTION test_fail_control()')
    }
  })

  it('una plantilla importada con dominios sin hijos entra como borrador y NO se publica hasta agruparla', async () => {
    const res = await upload(yamlFile({ controls: [{ title: 'Solo' }] }), { name: 'Plana' })
    expect(res.status).toBe(201)
    expect((await post(`${T}/${res.body.data.template.id}/publish`)).body.error.code).toBe('TEMPLATE_INVALID_STRUCTURE')
  })
})

describe('exportar', () => {
  it('devuelve un .yaml con el árbol anidado; sin el envoltorio { data }', async () => {
    const id = await templateWith(
      [
        {
          title: 'Dominio',
          reference: 'D1',
          description: 'desc',
          kids: [{ title: 'Objetivo', kids: [{ title: 'Criterio', reference: 'D1.1' }] }, { title: 'Directo' }],
        },
        { title: 'Otro', kids: [{ title: 'h' }] },
      ],
      'ISO/IEC 27001:2022',
    )
    const res = await download(id)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe(YAML_MIME)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="ISO_IEC 27001_2022\.yaml"; filename\*=UTF-8''ISO%2FIEC%2027001%3A2022\.yaml$/,
    )

    const doc = parseYaml((res.body as Buffer).toString('utf8'))
    expect(doc).toEqual({
      name: 'ISO/IEC 27001:2022',
      controls: [
        {
          reference: 'D1',
          title: 'Dominio',
          description: 'desc',
          controls: [
            {
              reference: null,
              title: 'Objetivo',
              description: null,
              controls: [{ reference: 'D1.1', title: 'Criterio', description: null }],
            },
            { reference: null, title: 'Directo', description: null },
          ],
        },
        {
          reference: null,
          title: 'Otro',
          description: null,
          controls: [{ reference: null, title: 'h', description: null }],
        },
      ],
    })
  })

  it('cualquier nombre de plantilla produce un encabezado seguro (sin comillas, saltos de línea ni caracteres de control)', async () => {
    for (const name of ['Norma "ASFI"; v2', 'línea\r\nSet-Cookie: x=1', 'ñandú/€', '???', 'a'.repeat(190)]) {
      const id = await createTemplate(name)
      const res = await download(id)
      expect(res.status).toBe(200)
      const disposition = String(res.headers['content-disposition'])
      expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~!*()'-]+$/)
      expect(disposition.match(/filename="([^"]*)"/)![1]).not.toMatch(/["\\/:;]/)
    }
  })

  it('permisos y errores: un auditor exporta (lectura); sin token 401; inexistente 404; id mal formado 400', async () => {
    const id = await templateWith(VALID)
    expect((await download(id, 'auditor')).status).toBe(200)
    expect((await api().get(`${T}/${id}/export`)).status).toBe(401)
    expect((await download(UNKNOWN_ID)).status).toBe(404)
    expect((await download('x')).status).toBe(400)
  })

  it('IDA Y VUELTA: exportar e importar como plantilla nueva reproduce el árbol tal cual (referencias, descripciones, profundidades desiguales, orden)', async () => {
    const original = await templateWith(
      [
        {
          title: 'A.5 Organizacionales',
          reference: 'A.5',
          description: 'Tema',
          kids: [
            { title: 'Políticas', reference: 'A.5.1' },
            {
              title: 'Roles',
              kids: [
                { title: 'Líder', reference: 'a)' },
                { title: 'Suplente', reference: 'a)' },
              ],
            },
          ],
        },
        {
          title: 'A.10 Criptografía',
          reference: 'A.10',
          kids: [{ title: '¿Se cifran los respaldos?', description: 'Línea 1\nLínea 2 — ñ ü €' }],
        },
        {
          title: 'APO',
          kids: [{ title: 'APO01', kids: [{ title: 'APO01.01', kids: [{ title: 'Actividad', reference: 'II' }] }] }],
        },
      ],
      'Original',
    )
    const exported = await download(original)
    const res = await upload(exported.body as Buffer, { name: 'Copia' })
    expect(res.status).toBe(201)
    expect(await shape(res.body.data.template.id)).toEqual(await shape(original))
  })
})
