import { describe, expect, it } from 'vitest'
import { ControlTree, placeAmong, type ControlNode } from './control-tree.js'

interface Spec {
  readonly id: string
  readonly reference?: string
  readonly kids?: readonly Spec[]
}

/** Aplana una descripción anidada. La posición sale del orden de escritura; el `id` es distinto de la referencia. */
function nodes(specs: readonly Spec[], parentId: string | null = null): Array<ControlNode & { reference?: string }> {
  return specs.flatMap((spec, position) => [
    { id: spec.id, parentId, position, ...(spec.reference && { reference: spec.reference }) },
    ...nodes(spec.kids ?? [], spec.id),
  ])
}
const treeOf = (specs: readonly Spec[]) => new ControlTree(nodes(specs))
const ids = (list: readonly ControlNode[]) => list.map((n) => n.id)

// ── Las numeraciones que hicieron fallar al proyecto anterior (agrupaba por prefijo del código) ────────────────
const ISO_2022 = [
  {
    id: 'tema-org',
    reference: 'A.5',
    kids: [
      { id: 'pol', reference: 'A.5.1' },
      { id: 'roles', reference: 'A.5.2' },
    ],
  },
  { id: 'tema-pers', reference: 'A.6', kids: [{ id: 'selec', reference: 'A.6.1' }] },
]

const COBIT = [
  {
    id: 'apo',
    reference: 'APO',
    kids: [
      {
        id: 'apo01',
        reference: 'APO01',
        kids: [
          {
            id: 'apo01-01',
            reference: 'APO01.01',
            kids: [
              { id: 'act-a', reference: 'a' },
              { id: 'act-b', reference: 'b' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'edm',
    reference: 'EDM',
    kids: [{ id: 'edm01', reference: 'EDM01', kids: [{ id: 'edm01-01', reference: 'EDM01.01' }] }],
  },
]

const ASFI = [
  {
    id: 'art5',
    reference: 'Art. 5',
    kids: [{ id: 'inc-i', reference: 'I)', kids: [{ id: 'lit-a', reference: 'a)' }] }],
  },
  { id: 'art6', reference: 'Art. 6', kids: [{ id: 'art6-1', reference: 'Art. 6.1' }] },
]

describe('dominio y ruta de cada hoja (independientes de la referencia)', () => {
  it('ISO 27001:2022 (2 niveles): el dominio de cada hoja es su tema', () => {
    const tree = treeOf(ISO_2022)
    expect(ids(tree.leaves())).toEqual(['pol', 'roles', 'selec'])
    expect(tree.rootOf('pol').id).toBe('tema-org')
    expect(tree.rootOf('roles').id).toBe('tema-org')
    expect(tree.rootOf('selec').id).toBe('tema-pers')
    expect(ids(tree.pathTo('roles'))).toEqual(['tema-org', 'roles'])
  })

  it('COBIT (4 niveles): la hoja "a" cuelga del dominio APO aunque su referencia ("a") no tenga relación con "APO"', () => {
    const tree = treeOf(COBIT)
    expect(tree.rootOf('act-a').id).toBe('apo')
    expect(ids(tree.pathTo('act-b'))).toEqual(['apo', 'apo01', 'apo01-01', 'act-b'])
    expect(tree.depthOf('act-b')).toBe(3)
    expect(tree.rootOf('edm01-01').id).toBe('edm')
  })

  it('ASFI: dominios "Art. 5" con incisos y literales; el dominio de un literal no depende de la numeración', () => {
    const tree = treeOf(ASFI)
    expect(tree.rootOf('lit-a').id).toBe('art5')
    expect(tree.rootOf('art6-1').id).toBe('art6')
    expect(ids(tree.roots())).toEqual(['art5', 'art6'])
  })

  it('numeraciones sin puntos, con letras o romanos: la jerarquía es solo parentId', () => {
    const tree = treeOf([
      {
        id: 'x',
        reference: 'II',
        kids: [
          { id: 'y', reference: 'II' },
          { id: 'z', reference: '' },
        ],
      },
    ])
    expect(tree.rootOf('z').id).toBe('x')
    expect(ids(tree.leaves())).toEqual(['y', 'z'])
  })

  it('ramas de distinta profundidad en la misma norma: hojas a 1 y a 3 niveles bajo el dominio', () => {
    const tree = treeOf([
      { id: 'd', kids: [{ id: 'directa' }, { id: 'grupo', kids: [{ id: 'sub', kids: [{ id: 'profunda' }] }] }] },
    ])
    expect(ids(tree.leaves())).toEqual(['directa', 'profunda'])
    expect(tree.depthOf('directa')).toBe(1)
    expect(tree.depthOf('profunda')).toBe(3)
    expect(tree.rootOf('profunda').id).toBe('d')
    expect(tree.maxDepth()).toBe(3)
  })

  it('un dominio es su propia ruta y su propio dominio', () => {
    const tree = treeOf(ISO_2022)
    expect(tree.rootOf('tema-org').id).toBe('tema-org')
    expect(ids(tree.pathTo('tema-org'))).toEqual(['tema-org'])
    expect(tree.depthOf('tema-org')).toBe(0)
  })
})

describe('orden', () => {
  it('lo da `position`, no el orden de la lista ni el id ni ninguna comparación de texto ("A.10" después de "A.5")', () => {
    const tree = new ControlTree([
      { id: 'z-ultimo', parentId: 'r', position: 2 },
      { id: 'a-primero', parentId: 'r', position: 0 },
      { id: 'r', parentId: null, position: 0 },
      { id: 'm-medio', parentId: 'r', position: 1 },
    ])
    expect(ids(tree.readingOrder())).toEqual(['r', 'a-primero', 'm-medio', 'z-ultimo'])
  })

  it('el orden de lectura es padre, luego sus hijos completos, luego el siguiente hermano', () => {
    const tree = treeOf(COBIT)
    expect(ids(tree.readingOrder())).toEqual(['apo', 'apo01', 'apo01-01', 'act-a', 'act-b', 'edm', 'edm01', 'edm01-01'])
  })

  it('si dos hermanos empatan en posición, el orden sigue siendo siempre el mismo (por id)', () => {
    const a = new ControlTree([
      { id: 'b', parentId: null, position: 0 },
      { id: 'a', parentId: null, position: 0 },
    ])
    const b = new ControlTree([
      { id: 'a', parentId: null, position: 0 },
      { id: 'b', parentId: null, position: 0 },
    ])
    expect(ids(a.readingOrder())).toEqual(['a', 'b'])
    expect(ids(b.readingOrder())).toEqual(['a', 'b'])
  })
})

describe('estructura', () => {
  it('detecta los dominios sin hijos (una plantilla plana no se puede publicar)', () => {
    const tree = treeOf([{ id: 'con', kids: [{ id: 'h' }] }, { id: 'sola' }, { id: 'otra' }])
    expect(ids(tree.childlessRoots())).toEqual(['sola', 'otra'])
    expect(ids(treeOf(ISO_2022).childlessRoots())).toEqual([])
  })

  it('un árbol vacío es válido y no tiene nada', () => {
    const tree = new ControlTree([])
    expect(tree.size).toBe(0)
    expect(tree.leaves()).toEqual([])
    expect(tree.maxDepth()).toBe(-1)
  })

  it('subtreeIds incluye el nodo y todos sus descendientes', () => {
    expect(treeOf(COBIT).subtreeIds('apo01').sort()).toEqual(['act-a', 'act-b', 'apo01', 'apo01-01'])
  })
})

describe('mover', () => {
  const tree = treeOf(COBIT)

  it('mover un nodo bajo sí mismo o bajo un descendiente crea un ciclo', () => {
    expect(tree.wouldCreateCycle('apo', 'apo')).toBe(true)
    expect(tree.wouldCreateCycle('apo', 'act-a')).toBe(true)
    expect(tree.wouldCreateCycle('apo01', 'apo01-01')).toBe(true)
  })

  it('mover bajo un nodo no relacionado, o a primer nivel, no', () => {
    expect(tree.wouldCreateCycle('apo01', 'edm')).toBe(false)
    expect(tree.wouldCreateCycle('act-a', 'act-b')).toBe(false)
    expect(tree.wouldCreateCycle('apo01', null)).toBe(false)
  })

  it('profundidad que tendría el subárbol tras moverlo', () => {
    expect(tree.depthAfterMove('act-a', null)).toBe(0) // una hoja a primer nivel
    expect(tree.depthAfterMove('apo01', 'edm')).toBe(3) // apo01 queda en nivel 1 y su rama baja 2 niveles más
    expect(tree.depthAfterMove('apo', null)).toBe(3) // no cambia
  })
})

describe('datos incoherentes (corrupción, no caso de usuario)', () => {
  it('padre inexistente', () => {
    expect(() => new ControlTree([{ id: 'a', parentId: 'no-existe', position: 0 }])).toThrow(/padre inexistente/)
  })

  it('ciclo', () => {
    expect(
      () =>
        new ControlTree([
          { id: 'r', parentId: null, position: 0 },
          { id: 'a', parentId: 'b', position: 0 },
          { id: 'b', parentId: 'a', position: 0 },
        ]),
    ).toThrow(/ciclo/)
  })

  it('id duplicado', () => {
    expect(
      () =>
        new ControlTree([
          { id: 'a', parentId: null, position: 0 },
          { id: 'a', parentId: null, position: 1 },
        ]),
    ).toThrow(/duplicado/)
  })

  it('preguntar por un nodo que no existe falla en voz alta', () => {
    expect(() => treeOf(ISO_2022).rootOf('fantasma')).toThrow(/inexistente/)
  })
})

describe('árboles grandes', () => {
  it('una cadena de 5000 niveles no desborda la pila', () => {
    const chain = Array.from({ length: 5000 }, (_v, i) => ({
      id: `n${i}`,
      parentId: i === 0 ? null : `n${i - 1}`,
      position: 0,
    }))
    const tree = new ControlTree(chain)
    expect(tree.maxDepth()).toBe(4999)
    expect(tree.rootOf('n4999').id).toBe('n0')
  })
})

describe('placeAmong (reordenar hermanos)', () => {
  it('subir, bajar, al inicio y al final', () => {
    expect(placeAmong(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(placeAmong(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(placeAmong(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })

  it('un índice fuera de rango se acota', () => {
    expect(placeAmong(['a', 'b'], 'a', 99)).toEqual(['b', 'a'])
    expect(placeAmong(['a', 'b'], 'b', -5)).toEqual(['b', 'a'])
  })

  it('insertar uno que no estaba (nuevo o de otro padre)', () => {
    expect(placeAmong(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b'])
    expect(placeAmong([], 'x', 0)).toEqual(['x'])
  })
})
