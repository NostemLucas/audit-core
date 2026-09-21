import { describe, expect, it } from 'vitest'
import { attachment } from './files.js'

describe('attachment (Content-Disposition seguro)', () => {
  it('un nombre normal lleva el respaldo ASCII y el nombre real codificado', () => {
    expect(attachment('ISO/IEC 27001:2022', 'xlsx')).toBe(
      `attachment; filename="ISO_IEC 27001_2022.xlsx"; filename*=UTF-8''ISO%2FIEC%2027001%3A2022.xlsx`,
    )
  })

  it('el respaldo ASCII nunca lleva comillas, barras, punto y coma ni caracteres de control', () => {
    for (const name of ['Norma "ASFI"; v2', 'línea\r\nSet-Cookie: x=1', 'a\\b/c', 'x\u0000y']) {
      const ascii = attachment(name, 'xlsx').match(/filename="([^"]*)"/)![1]!
      expect(ascii).toMatch(/^[\x20-\x7e]*$/)
      expect(ascii).not.toMatch(/["\\/:;]/)
    }
  })

  it('el nombre real solo usa caracteres seguros (todo lo demás va en %XX)', () => {
    const value = attachment('ñandú/€ "x"\r\n', 'xlsx').split("filename*=UTF-8''")[1]!
    expect(value).toMatch(/^[A-Za-z0-9%._~!*()'-]+$/)
    expect(decodeURIComponent(value)).toBe('ñandú/€ "x"\r\n.xlsx')
  })

  it('un nombre que queda vacío en ASCII usa un nombre genérico en el respaldo', () => {
    expect(attachment('€€€', 'xlsx')).toMatch(/^attachment; filename="archivo\.xlsx"; filename\*=/)
  })
})
