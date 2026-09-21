import { describe, expect, it } from 'vitest'
import { formatAuditCode } from './audit-code.js'

describe('formatAuditCode', () => {
  it('año y número con cinco cifras', () => {
    expect(formatAuditCode(2026, 1)).toBe('AUD-2026-00001')
    expect(formatAuditCode(2026, 42)).toBe('AUD-2026-00042')
    expect(formatAuditCode(2027, 99999)).toBe('AUD-2027-99999')
  })

  it('pasado de cinco cifras el código crece, no se trunca (sigue siendo único)', () => {
    expect(formatAuditCode(2026, 123456)).toBe('AUD-2026-123456')
  })
})
