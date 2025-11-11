import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.NETLIFY_BLOBS_SITE_ID
  delete process.env.NETLIFY_BLOBS_TOKEN
  delete process.env.NETLIFY_BLOBS_STORE
  delete process.env.NETLIFY_BLOBS_API_URL
  delete process.env.NETLIFY_BLOBS_CONTEXT
  delete process.env.MY_DEPLOY_ID
  delete process.env.NETLIFY_DEPLOY_ID
  delete process.env.DEPLOY_ID
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('safeBlobStore', () => {
  it('initializes a Netlify store when all configuration is present', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_TOKEN = 'api-token'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'
    process.env.NETLIFY_BLOBS_API_URL = 'https://api.netlify.com/api/v1/blobs'
    process.env.MY_DEPLOY_ID = 'deploy-override'
    process.env.NETLIFY_DEPLOY_ID = 'deploy-1234'

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const storeMock = { ready: true }
    const getStoreSpy = vi.fn(() => storeMock)
    vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

    const { safeBlobStore } = await import('@/utils/blob-env')
    const store = await safeBlobStore()

    expect(store).toBe(storeMock)
    expect(getStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'store-name',
        siteID: '12345678-1234-1234-1234-1234567890ab',
        token: 'api-token',
        apiURL: 'https://api.netlify.com/api/v1/blobs',
        deployID: 'deploy-override',
      }),
    )

    const snapshotLog = logSpy.mock.calls.find((call) => call[2] === 'safe-blob-store-env-snapshot')
    expect(snapshotLog?.[3]).toMatchObject({ deployIDSource: 'MY_DEPLOY_ID', deployID: 'deploy-override' })
  })

  it('prefers MY_DEPLOY_ID over legacy deploy identifiers', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_TOKEN = 'api-token'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'
    process.env.NETLIFY_BLOBS_API_URL = 'https://api.netlify.com/api/v1/blobs'
    process.env.MY_DEPLOY_ID = 'custom-deploy'
    process.env.NETLIFY_DEPLOY_ID = 'netlify-deploy'
    process.env.DEPLOY_ID = 'fallback-deploy'

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const storeMock = { ready: true }
    const getStoreSpy = vi.fn(() => storeMock)
    vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

    const { safeBlobStore } = await import('@/utils/blob-env')
    await safeBlobStore()

    expect(getStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deployID: 'custom-deploy',
      }),
    )

    const snapshotLog = logSpy.mock.calls.find((call) => call[2] === 'safe-blob-store-env-snapshot')
    expect(snapshotLog?.[3]).toMatchObject({ deployIDSource: 'MY_DEPLOY_ID', deployID: 'custom-deploy' })
  })

  it('throws when configuration is incomplete', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'
    process.env.NETLIFY_BLOBS_API_URL = 'https://api.netlify.com/api/v1/blobs'
    process.env.NETLIFY_DEPLOY_ID = 'deploy-incomplete-test'

    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))

    const { safeBlobStore } = await import('@/utils/blob-env')

    await expect(safeBlobStore()).rejects.toThrow(/Missing blob env: NETLIFY_BLOBS_TOKEN/i)
  })
})

describe('putBlobFromBuffer', () => {
  it('uploads via Netlify when credentials are provided', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_TOKEN = 'api-token'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'
    process.env.NETLIFY_BLOBS_API_URL = 'https://api.netlify.com/api/v1/blobs'
    process.env.NETLIFY_DEPLOY_ID = 'deploy-from-netlify'
    process.env.URL = 'https://deploy.example.netlify.app'

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const setSpy = vi.fn(async () => ({}))
    const storeMock = {
      set: setSpy,
      list: vi.fn(async () => ({ blobs: [] })),
      getMetadata: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      getWithMetadata: vi.fn(async () => null),
    }

    const getStoreSpy = vi.fn(() => storeMock)
    vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

    const { putBlobFromBuffer } = await import('@/lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    const firstCall = getStoreSpy.mock.calls.at(0)
    const callArgs = Array.isArray(firstCall) ? (firstCall as unknown[]) : []
    const configArg = (callArgs[0] ?? null) as Record<string, unknown> | null

    expect(configArg).toMatchObject({
      name: 'store-name',
      siteID: '12345678-1234-1234-1234-1234567890ab',
      token: 'api-token',
      apiURL: 'https://api.netlify.com/api/v1/blobs',
      deployID: 'deploy-from-netlify',
    })
    expect(configArg?.edgeURL).toBeUndefined()
    expect(configArg?.uncachedEdgeURL).toBeUndefined()
    expect(configArg?.consistency).toBeUndefined()
    expect(setSpy).toHaveBeenCalled()
    expect(result.url).toBe('/api/blob/path/file.txt')
    expect(result.downloadUrl).toBe('https://deploy.example.netlify.app/api/blob/path/file.txt')

    const deployLog = logSpy.mock.calls.find((call) => call[2] === 'deploy-id:selected')
    expect(deployLog?.[3]).toMatchObject({
      selected: expect.objectContaining({ key: 'NETLIFY_DEPLOY_ID', valuePreview: 'deploy-from-netlify' }),
    })
  })

  it('uploads via Netlify without a token when the site ID is canonical', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'
    process.env.NETLIFY_BLOBS_API_URL = 'https://api.netlify.com/api/v1/blobs'

    const setSpy = vi.fn(async () => ({}))
    const storeMock = {
      set: setSpy,
      list: vi.fn(async () => ({ blobs: [] })),
      getMetadata: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      getWithMetadata: vi.fn(async () => null),
    }

    const getStoreSpy = vi.fn(() => storeMock)
    vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

    const { putBlobFromBuffer } = await import('@/lib/blob')
    await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    expect(getStoreSpy).toHaveBeenCalled()
    const firstCall = getStoreSpy.mock.calls.at(0)
    const callArgs = Array.isArray(firstCall) ? (firstCall as unknown[]) : []
    const configArg = callArgs[0] ?? null
    const call = (configArg && typeof configArg === 'object' ? configArg : {}) as Record<string, unknown>
    expect(call).toMatchObject({ name: 'store-name', siteID: '12345678-1234-1234-1234-1234567890ab' })
    expect('token' in call).toBe(false)
    expect(setSpy).toHaveBeenCalled()
  })

  it('falls back to a data URL when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer } = await import('@/lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
    expect(result.downloadUrl).toBe(result.url)
  })
})

it('resolves a site slug to the canonical Netlify site ID', async () => {
  process.env.NETLIFY_BLOBS_SITE_ID = 'dadsbot'
  process.env.NETLIFY_BLOBS_TOKEN = 'api-token'
  process.env.NETLIFY_BLOBS_STORE = 'store-name'
  process.env.NETLIFY_BLOBS_API_URL = 'https://api.netlify.com/api/v1/blobs'

  const setSpy = vi.fn(async () => ({}))
  const storeMock = {
    set: setSpy,
    list: vi.fn(async () => ({ blobs: [] })),
    getMetadata: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    getWithMetadata: vi.fn(async () => null),
  }

  const getStoreSpy = vi.fn(() => storeMock)
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: '98765432-4321-4321-4321-ba0987654321', name: 'dadsbot-site' }),
  }))
  vi.stubGlobal('fetch', fetchSpy)

  vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

  const { putBlobFromBuffer } = await import('@/lib/blob')
  await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

  expect(fetchSpy).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/sites/dadsbot'),
    expect.objectContaining({ method: 'GET' }),
  )

  expect(getStoreSpy).toHaveBeenCalledWith(
    expect.objectContaining({ siteID: '98765432-4321-4321-4321-ba0987654321' }),
  )
})

it('falls back to memory when given a site slug without a token to resolve it', async () => {
  process.env.NETLIFY_BLOBS_SITE_ID = 'dadsbot'
  process.env.NETLIFY_BLOBS_STORE = 'store-name'

  const setSpy = vi.fn(async () => ({}))
  const storeMock = {
    set: setSpy,
    list: vi.fn(async () => ({ blobs: [] })),
    getMetadata: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    getWithMetadata: vi.fn(async () => null),
  }

  const getStoreSpy = vi.fn(() => storeMock)
  vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

  const { putBlobFromBuffer } = await import('@/lib/blob')
  const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

  expect(getStoreSpy).not.toHaveBeenCalled()
  expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
  expect(result.downloadUrl).toBe(result.url)
})

describe('listBlobs', () => {
  it('returns fallback entries when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer, listBlobs, clearFallbackBlobs } = await import('@/lib/blob')
    clearFallbackBlobs()

    await putBlobFromBuffer('sessions/test/item.json', Buffer.from('{}'), 'application/json')
    const result = await listBlobs({ prefix: 'sessions/test/' })

    expect(result.blobs).toHaveLength(1)
    expect(result.blobs[0].pathname).toBe('sessions/test/item.json')
    expect(result.blobs[0].downloadUrl).toEqual(result.blobs[0].url)
  })
})
