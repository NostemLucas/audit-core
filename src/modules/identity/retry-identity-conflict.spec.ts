import { describe, expect, it } from 'vitest'
import { DomainError } from '../../platform/errors/index.js'
import '../../app-errors.js'
import { IdentityErrors } from './errors.js'
import { retryOnceOnIdentityConflict } from './retry-identity-conflict.js'

const conflict = () => new DomainError(IdentityErrors.USER_IDENTITY_CONFLICT)

describe('retryOnceOnIdentityConflict (la carrera del primer login, sin depender de tiempos)', () => {
  it('sin conflicto: se ejecuta UNA vez', async () => {
    let calls = 0
    await expect(retryOnceOnIdentityConflict(async () => (++calls, 'ok'))).resolves.toBe('ok')
    expect(calls).toBe(1)
  })

  it('un conflicto y luego éxito (perdió la carrera; ahora el usuario ya existe): reintenta y devuelve el resultado', async () => {
    let calls = 0
    const result = await retryOnceOnIdentityConflict(async () => {
      if (++calls === 1) throw conflict()
      return 'leído tras la carrera'
    })
    expect(result).toBe('leído tras la carrera')
    expect(calls).toBe(2)
  })

  it('un conflicto que PERSISTE es real: se reintenta una sola vez y se propaga (no hay bucle)', async () => {
    let calls = 0
    await expect(
      retryOnceOnIdentityConflict(async () => {
        ++calls
        throw conflict()
      }),
    ).rejects.toMatchObject({ code: 'USER_IDENTITY_CONFLICT' })
    expect(calls).toBe(2)
  })

  it('cualquier otro error NO se reintenta', async () => {
    let calls = 0
    await expect(
      retryOnceOnIdentityConflict(async () => {
        ++calls
        throw new Error('otra cosa')
      }),
    ).rejects.toThrow('otra cosa')
    expect(calls).toBe(1)
  })

  it('otro DomainError distinto del conflicto tampoco se reintenta', async () => {
    let calls = 0
    await expect(
      retryOnceOnIdentityConflict(async () => {
        ++calls
        throw new DomainError(IdentityErrors.TOKEN_CLAIMS_MISSING)
      }),
    ).rejects.toMatchObject({ code: 'TOKEN_CLAIMS_MISSING' })
    expect(calls).toBe(1)
  })
})
