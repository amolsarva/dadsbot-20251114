import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpKeysPath = path.join(process.cwd(), 'tmpkeys.txt')

function writeSecrets(contents: string) {
  fs.writeFileSync(tmpKeysPath, contents, 'utf8')
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  if (fs.existsSync(tmpKeysPath)) {
    fs.unlinkSync(tmpKeysPath)
  }
})

describe('blob storage in memory mode', () => {
  beforeEach(() => {
    writeSecrets(`STORAGE_MODE=memory\n`)
  })

  it('stores and lists blobs in memory', async () => {
    const { refreshSecretsCache } = await import('@/lib/secrets.server')
    refreshSecretsCache()

    const { putBlobFromBuffer, listBlobs, readBlob, clearFallbackBlobs } = await import('@/lib/blob')

    clearFallbackBlobs()

    const data = Buffer.from(JSON.stringify({ ok: true }), 'utf8')
    await putBlobFromBuffer('sessions/test/session.json', data, 'application/json')

    const list = await listBlobs({ prefix: 'sessions/test/' })
    expect(list.blobs.length).toBe(1)
    expect(list.blobs[0]).toMatchObject({ pathname: 'sessions/test/session.json' })

    const record = await readBlob('sessions/test/session.json')
    expect(record?.contentType).toBe('application/json')
    expect(record?.buffer.toString('utf8')).toContain('ok')
  })
})

describe('blob storage in supabase mode', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    writeSecrets(
      [
        'STORAGE_MODE=supabase',
        'SUPABASE_URL=https://example.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY=service-role-key',
        'SUPABASE_STORAGE_BUCKET=artifacts',
      ].join('\n') + '\n',
    )

    fetchSpy.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const url = typeof input === 'string' ? input : input.toString()
      if (method === 'POST' && url.includes('/object/list/')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      if (method === 'POST') {
        return new Response(null, { status: 200 })
      }
      if (method === 'GET') {
        return new Response('supabase-data', {
          status: 200,
          headers: { 'content-type': 'text/plain', 'content-length': '14' },
        })
      }
      if (method === 'DELETE') {
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
  })

  it('initializes the Supabase client and performs CRUD operations', async () => {
    const { refreshSecretsCache } = await import('@/lib/secrets.server')
    refreshSecretsCache()

    const { putBlobFromBuffer, readBlob, deleteBlob } = await import('@/lib/blob')

    const buffer = Buffer.from('hello-world', 'utf8')
    const result = await putBlobFromBuffer('sessions/demo/item.txt', buffer, 'text/plain')
    expect(result.url).toContain('sessions/demo/item.txt')
    expect(fetchSpy).toHaveBeenCalled()

    const record = await readBlob('sessions/demo/item.txt')
    expect(record?.buffer.toString('utf8')).toContain('supabase-data')
    expect(fetchSpy).toHaveBeenCalled()

    await deleteBlob('sessions/demo/item.txt')
    expect(fetchSpy).toHaveBeenCalled()
  })
})
