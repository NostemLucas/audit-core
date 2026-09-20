import { describe, expect, it } from 'vitest'
import * as generated from '../src/generated/prisma/enums.js'
import * as shared from '../src/shared/enums.js'

describe('shared/enums', () => {
  it('reexporta TODOS los enums del schema de Prisma, con los mismos valores', () => {
    expect(Object.keys(shared).sort()).toEqual(Object.keys(generated).sort())
    for (const [name, values] of Object.entries(generated)) {
      expect(shared[name as keyof typeof shared], name).toEqual(values)
    }
  })
})
