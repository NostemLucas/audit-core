import { describe, expect, it } from 'vitest'
import '../../../../app-errors.js'
import { buildImportPlan } from '../domain/control-import.js'
import { readTemplateYaml, writeTemplateYaml } from './template-yaml.js'

const rejection = (work: () => unknown) => {
  try {
    work()
    return undefined
  } catch (error) {
    return error
  }
}

describe('readTemplateYaml', () => {
  it('la anidación de "controls" es la jerarquía; el nombre sale de "name"', () => {
    const file = Buffer.from(
      `name: ISO/IEC 27001:2022
controls:
  - reference: A.5
    title: Controles organizacionales
    description: Descripción del tema
    controls:
      - reference: A.5.1
        title: Políticas
      - reference: A.5.2
        title: Roles
`,
      'utf8',
    )
    const content = readTemplateYaml(file)
    expect(content.name).toBe('ISO/IEC 27001:2022')
    expect(content.tree).toEqual([
      {
        reference: 'A.5',
        title: 'Controles organizacionales',
        description: 'Descripción del tema',
        controls: [
          { reference: 'A.5.1', title: 'Políticas' },
          { reference: 'A.5.2', title: 'Roles' },
        ],
      },
    ])
  })

  it('sin "name": el archivo puede no traerlo (viene del formulario)', () => {
    const content = readTemplateYaml(Buffer.from('controls:\n  - title: x\n', 'utf8'))
    expect(content.name).toBeUndefined()
  })

  it('sin "controls": un árbol vacío (buildImportPlan lo rechaza con su propio mensaje)', () => {
    const content = readTemplateYaml(Buffer.from('name: Vacía\n', 'utf8'))
    expect(content.tree).toEqual([])
  })

  it('un YAML mal formado: TEMPLATE_IMPORT_INVALID', () => {
    const error = rejection(() => readTemplateYaml(Buffer.from('controls: [x: y: z\n', 'utf8')))
    expect(error).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
      details: { errors: [{ message: expect.stringMatching(/no es un YAML válido/) }] },
    })
  })

  it('un archivo vacío: TEMPLATE_IMPORT_INVALID', () => {
    expect(rejection(() => readTemplateYaml(Buffer.alloc(0)))).toMatchObject({ code: 'TEMPLATE_IMPORT_INVALID' })
  })

  it('una lista en vez de un objeto (forma inesperada): TEMPLATE_IMPORT_INVALID', () => {
    const error = rejection(() => readTemplateYaml(Buffer.from('- a\n- b\n', 'utf8')))
    expect(error).toMatchObject({
      code: 'TEMPLATE_IMPORT_INVALID',
      details: { errors: [{ message: expect.stringMatching(/formato esperado/) }] },
    })
  })

  it('un nodo sin título: se acepta al leer (falta el título lo informa `buildImportPlan`, no el lector)', () => {
    const content = readTemplateYaml(Buffer.from('controls:\n  - reference: A.5\n', 'utf8'))
    expect(buildImportPlan(content.tree)).toMatchObject({ ok: false, issues: [{ message: 'Falta el título' }] })
  })
})

describe('ida y vuelta: escribir y volver a leer', () => {
  it('conserva referencia, título, descripción y la jerarquía (varios niveles y hermanos)', () => {
    const controls = [
      {
        reference: 'A.5',
        title: 'Controles organizacionales',
        description: 'Los controles de la organización',
        controls: [
          {
            reference: 'A.5.1',
            title: 'Políticas para la seguridad de la información',
            description: null,
            controls: [],
          },
          {
            reference: null,
            title: '¿Existe un procedimiento de copias de seguridad?',
            description: 'Línea 1\nLínea 2 con acentos: ñ, á, ü y símbolos: €, ≥',
            controls: [{ reference: null, title: 'sub', description: null, controls: [] }],
          },
        ],
      },
      { reference: 'II', title: 'Segundo dominio', description: 'x'.repeat(5000), controls: [] },
    ]
    const file = writeTemplateYaml({ name: 'ISO/IEC 27001:2022', controls })
    const content = readTemplateYaml(file)
    expect(content.name).toBe('ISO/IEC 27001:2022')
    const plan = buildImportPlan(content.tree)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.nodes.map((n) => [n.title, n.parentIndex, n.reference, n.description])).toEqual([
        ['Controles organizacionales', null, 'A.5', 'Los controles de la organización'],
        ['Políticas para la seguridad de la información', 0, 'A.5.1', null],
        [
          '¿Existe un procedimiento de copias de seguridad?',
          0,
          null,
          'Línea 1\nLínea 2 con acentos: ñ, á, ü y símbolos: €, ≥',
        ],
        ['sub', 2, null, null],
        ['Segundo dominio', null, 'II', 'x'.repeat(5000)],
      ])
    }
  })

  it('una plantilla vacía se escribe y se lee sin controles', () => {
    const content = readTemplateYaml(writeTemplateYaml({ name: 'Vacía', controls: [] }))
    expect(content.name).toBe('Vacía')
    expect(content.tree).toEqual([])
  })
})
