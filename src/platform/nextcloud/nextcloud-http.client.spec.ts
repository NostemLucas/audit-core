import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Clock } from '../clock/index.js'
import { DomainError } from '../errors/index.js'
import { testEnv } from '../../../test/support/env.js'
import { NextcloudHttpClient } from './nextcloud-http.client.js'

const env = testEnv()
const clock: Clock = { now: () => new Date('2026-03-05T10:00:00.000Z') }
const client = new NextcloudHttpClient(env, clock)

/** Una Response mínima, como la que devolvería `fetch`. */
function fakeResponse(status: number, options: { json?: unknown; headers?: Record<string, string> } = {}): Response {
  return {
    status,
    headers: new Headers(options.headers ?? {}),
    json: () => Promise.resolve(options.json),
  } as Response
}

const OCS_SHARE_OK = { ocs: { data: { url: 'https://nextcloud.test/s/abc123' } } }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createUploadTarget', () => {
  it('crea cada segmento de la ruta (MKCOL) y comparte con permiso UPLOAD_ONLY (5: READ+CREATE, sin UPDATE), con Basic Auth', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return url.toString().includes('/ocs/') ? fakeResponse(200, { json: OCS_SHARE_OK }) : fakeResponse(201)
      }),
    )

    const target = await client.createUploadTarget('/Auditorias/AUD-1/Evidencias/eval-1')
    expect(target.url).toBe('https://nextcloud.test/s/abc123')

    const mkcols = calls.filter((c) => c.init.method === 'MKCOL')
    expect(mkcols.map((c) => c.url)).toEqual([
      'https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias',
      'https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias/AUD-1',
      'https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias/AUD-1/Evidencias',
      'https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias/AUD-1/Evidencias/eval-1',
    ])
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>).authorization).toBe(
        `Basic ${Buffer.from('audit-core-test:test-password').toString('base64')}`,
      )
    }
    const share = calls.find((c) => c.url.includes('/ocs/'))!
    expect(share.init.method).toBe('POST')
    const params = new URLSearchParams(share.init.body as string)
    expect(params.get('permissions')).toBe('5') // READ(1) + CREATE(4), SIN UPDATE: no se puede sobrescribir
    expect(params.get('expireDate')).toBe('2026-03-06') // vence MAÑANA, nunca hoy (podría ya estar "en el pasado")
  })

  it('"mañana" cruza de mes/año correctamente (suma 24h reales, no solo el número de día)', async () => {
    const nyeClock: Clock = { now: () => new Date('2026-12-31T15:00:00.000Z') }
    const nyeClient = new NextcloudHttpClient(env, nyeClock)
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.toString().includes('/ocs/')) body = init.body as string
        return url.toString().includes('/ocs/') ? fakeResponse(200, { json: OCS_SHARE_OK }) : fakeResponse(201)
      }),
    )
    await nyeClient.createUploadTarget('/x')
    expect(new URLSearchParams(body).get('expireDate')).toBe('2027-01-01')
  })

  it('un 405 o 409 al crear una carpeta (ya existe) no es error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.toString().includes('/ocs/') ? fakeResponse(200, { json: OCS_SHARE_OK }) : fakeResponse(405),
      ),
    )
    await expect(client.createUploadTarget('/Auditorias/AUD-1/Evidencias/eval-1')).resolves.toMatchObject({
      url: 'https://nextcloud.test/s/abc123',
    })
  })

  it('un segmento con espacios o caracteres especiales se codifica, sin tocar las barras', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url))
        return url.toString().includes('/ocs/') ? fakeResponse(200, { json: OCS_SHARE_OK }) : fakeResponse(201)
      }),
    )
    await client.createUploadTarget('/Auditorias/AUD 1/Evidencias/eval#1')
    expect(calls).toContain('https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias/AUD%201')
    expect(calls).toContain(
      'https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias/AUD%201/Evidencias/eval%231',
    )
  })

  it('un error de red, o una respuesta que no viene con url, se traduce a UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    await expect(client.createUploadTarget('/x')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.toString().includes('/ocs/') ? fakeResponse(200, { json: {} }) : fakeResponse(201),
      ),
    )
    await expect(client.createUploadTarget('/x')).rejects.toBeInstanceOf(DomainError)
  })

  it('un estado inesperado (500) al crear la carpeta o el share también es UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(500)),
    )
    await expect(client.createUploadTarget('/x')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })
})

describe('upload', () => {
  it('asegura la carpeta PADRE (no el archivo), sube con el mimeType dado y lee `oc-fileid`', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return init.method === 'PUT' ? fakeResponse(201, { headers: { 'oc-fileid': '999' } }) : fakeResponse(201)
      }),
    )
    const result = await client.upload(
      '/Auditorias/AUD-1/Informes/rep-1.docx',
      Buffer.from('contenido'),
      'application/vnd.x',
    )
    expect(result).toEqual({ fileId: '999' })
    const mkcols = calls.filter((c) => c.init.method === 'MKCOL').map((c) => c.url)
    expect(mkcols.every((url) => !url.endsWith('rep-1.docx'))).toBe(true) // nunca MKCOL sobre el archivo
    const put = calls.find((c) => c.init.method === 'PUT')!
    expect((put.init.headers as Record<string, string>)['content-type']).toBe('application/vnd.x')
    expect(put.init.body).toEqual(Buffer.from('contenido'))
  })

  it('sin `oc-fileid` en la respuesta: UPSTREAM_UNAVAILABLE, no se inventa un id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => fakeResponse(init.method === 'PUT' ? 201 : 201)),
    )
    await expect(client.upload('/x/y.docx', Buffer.from(''), 'text/plain')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    })
  })
})

describe('createReadShare', () => {
  it('comparte con permiso READ_ONLY (1), sin crear ninguna carpeta, y vence MAÑANA', async () => {
    let mkcolCalled = false
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'MKCOL') mkcolCalled = true
        if (url.toString().includes('/ocs/')) body = init.body as string
        return fakeResponse(200, { json: OCS_SHARE_OK })
      }),
    )
    const share = await client.createReadShare('/Auditorias/AUD-1/Informes/rep-1.docx')
    expect(share.url).toBe('https://nextcloud.test/s/abc123')
    expect(mkcolCalled).toBe(false)
    expect(new URLSearchParams(body).get('expireDate')).toBe('2026-03-06')
  })
})

/** El fetch que ve `shareWithUser` en el caso normal: la ruta no tiene shares previos (LIST vacío). */
function stubNoExistingShares() {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'GET' && url.toString().includes('/ocs/'))
      return fakeResponse(200, { json: { ocs: { data: [] } } })
    return url.toString().includes('/ocs/') ? fakeResponse(200, { json: OCS_SHARE_OK }) : fakeResponse(201)
  })
}

describe('shareWithUser', () => {
  it('sin share previo: lista (vacío), crea la carpeta y comparte con shareType=0, sin expireDate', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return stubNoExistingShares()(url, init)
      }),
    )
    await client.shareWithUser('/Auditorias/AUD-1/Informes', 'ana', 'EDIT_NO_DELETE')

    const mkcols = calls.filter((c) => c.init.method === 'MKCOL')
    expect(mkcols.at(-1)?.url).toBe(
      'https://nextcloud.test/remote.php/dav/files/audit-core-test/Auditorias/AUD-1/Informes',
    )
    const share = calls.find((c) => c.init.method === 'POST')!
    const params = new URLSearchParams(share.init.body as string)
    expect(params.get('shareType')).toBe('0')
    expect(params.get('shareWith')).toBe('ana')
    expect(params.get('permissions')).toBe('3') // READ(1) + UPDATE(2), SIN CREATE ni DELETE
    expect(params.has('expireDate')).toBe(false)
  })

  it('READ_ONLY manda el bitmask 1', async () => {
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'POST') body = init.body as string
        return stubNoExistingShares()(url, init)
      }),
    )
    await client.shareWithUser('/Auditorias/AUD-1/Evidencias', 'ana', 'READ_ONLY')
    expect(new URLSearchParams(body).get('permissions')).toBe('1')
  })

  it('ya compartido con el MISMO permiso: no crea nada (idempotente, sin 502 al reintentar)', async () => {
    const listed = { ocs: { data: [{ id: '5', share_type: 0, share_with: 'ana', permissions: 3 }] } }
    let postCalled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'POST' && url.toString().includes('/ocs/')) postCalled = true
        if (init.method === 'GET' && url.toString().includes('/ocs/')) return fakeResponse(200, { json: listed })
        return fakeResponse(201)
      }),
    )
    await client.shareWithUser('/Auditorias/AUD-1/Informes', 'ana', 'EDIT_NO_DELETE')
    expect(postCalled).toBe(false)
  })

  it('ya compartido con OTRO permiso: lo borra y lo crea de nuevo con el nuevo', async () => {
    const listed = { ocs: { data: [{ id: '5', share_type: 0, share_with: 'ana', permissions: 3 }] } }
    const calls: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), method: init.method! })
        if (init.method === 'GET' && url.toString().includes('/ocs/')) return fakeResponse(200, { json: listed })
        return url.toString().includes('/ocs/') ? fakeResponse(200, { json: OCS_SHARE_OK }) : fakeResponse(201)
      }),
    )
    await client.shareWithUser('/Auditorias/AUD-1/Informes', 'ana', 'READ_ONLY')
    const ocsCalls = calls.filter((c) => c.url.includes('/ocs/'))
    expect(ocsCalls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'POST'])
    expect(ocsCalls[1]!.url).toContain('/shares/5')
  })
})

describe('unshareUser', () => {
  it('lista los shares de la ruta y borra por id solo el del usuario dado (shareType=0)', async () => {
    const listed = {
      ocs: {
        data: [
          { id: '10', share_type: 0, share_with: 'ana' },
          { id: '11', share_type: 0, share_with: 'luis' },
          { id: '12', share_type: 3, share_with: '' }, // un link público sobre la misma ruta: no se toca
        ],
      },
    }
    const deletes: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'DELETE') {
          deletes.push(String(url))
          return fakeResponse(200)
        }
        return fakeResponse(200, { json: listed })
      }),
    )
    await client.unshareUser('/Auditorias/AUD-1/Informes', 'ana')
    expect(deletes).toEqual(['https://nextcloud.test/ocs/v2.php/apps/files_sharing/api/v1/shares/10?format=json'])
  })

  it('sin ningún share de ese usuario sobre la ruta: no borra nada, no es error', async () => {
    let deleteCalled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'DELETE') deleteCalled = true
        return fakeResponse(200, { json: { ocs: { data: [] } } })
      }),
    )
    await expect(client.unshareUser('/Auditorias/AUD-1/Informes', 'nadie')).resolves.toBeUndefined()
    expect(deleteCalled).toBe(false)
  })

  it('un error de red al listar se traduce a UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    await expect(client.unshareUser('/x', 'ana')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })
})

describe('ping', () => {
  it('consulta `/status.php` SIN autenticación; 200 no lanza', async () => {
    let sawAuth = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://nextcloud.test/status.php')
        if ((init.headers as Record<string, string> | undefined)?.authorization) sawAuth = true
        return fakeResponse(200)
      }),
    )
    await expect(client.ping()).resolves.toBeUndefined()
    expect(sawAuth).toBe(false)
  })

  it('cualquier otro estado, o un error de red, lanza UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(503)),
    )
    await expect(client.ping()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })
})

describe('listFolder', () => {
  const PROPFIND_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/audit-core-test/Auditorias/AUD-1/Evidencias/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/audit-core-test/Auditorias/AUD-1/Evidencias/eval-1/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/audit-core-test/Auditorias/AUD-1/Evidencias/nota%20final.pdf</d:href>
    <d:propstat><d:prop>
      <d:getcontenttype>application/pdf</d:getcontenttype>
      <d:getcontentlength>2048</d:getcontentlength>
      <d:getlastmodified>Thu, 05 Mar 2026 10:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`

  it('devuelve los hijos directos (sin la carpeta misma), carpetas primero, con tamaño y fecha de cada archivo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 207, text: async () => PROPFIND_XML, headers: new Headers() }) as Response),
    )

    const entries = await client.listFolder('/Auditorias/AUD-1/Evidencias')

    expect(entries.map((e) => [e.name, e.isFolder])).toEqual([
      ['eval-1', true],
      ['nota final.pdf', false],
    ])
    expect(entries[1]).toMatchObject({
      path: '/Auditorias/AUD-1/Evidencias/nota final.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      modifiedAt: new Date('2026-03-05T10:00:00.000Z'),
    })
  })

  it('una carpeta inexistente (404) da lista vacía, no error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404, text: async () => '', headers: new Headers() }) as Response),
    )
    expect(await client.listFolder('/Auditorias/AUD-NUEVA/Informes')).toEqual([])
  })
})
