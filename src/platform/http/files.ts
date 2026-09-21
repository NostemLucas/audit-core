export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * `Content-Disposition` seguro para cualquier nombre: un respaldo ASCII sin comillas, barras ni caracteres de control
 * (nunca se inyectan encabezados) y el nombre real en `filename*` (RFC 5987).
 */
export function attachment(name: string, extension: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\/:*?<>|;,]/g, '_')
    .trim()
  return `attachment; filename="${ascii || 'archivo'}.${extension}"; filename*=UTF-8''${encodeURIComponent(name)}.${extension}`
}
