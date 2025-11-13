import { getSecret, requireSecret } from './secrets.server'
import { assertBlobEnv, describeBlobEnvSnapshot, getStorageMode, logBlobDiagnostic } from '@/utils/blob-env'

export const BLOB_PROXY_PREFIX = '/api/blob/'

export type PutBlobOptions = {
  access?: 'public'
  addRandomSuffix?: boolean
  cacheControlMaxAge?: number
}

export type ListedBlob = {
  pathname: string
  url: string
  downloadUrl: string
  uploadedAt?: string
  size?: number
}

export type ListBlobResult = {
  blobs: ListedBlob[]
  hasMore: boolean
  cursor?: string
}

export type ListCommandOptions = {
  prefix?: string
  limit?: number
  cursor?: string
}

export type ReadBlobResult = {
  buffer: Buffer
  contentType: string
  etag?: string
  cacheControl?: string
  uploadedAt?: string
  size?: number
}

type MemoryBlobRecord = {
  buffer: Buffer
  contentType: string
  uploadedAt: string
  size: number
  cacheControl?: string
}

export type BlobStorageMode = 'supabase' | 'memory'

type StorageMode = BlobStorageMode

type SupabaseState = {
  url: string
  bucket: string
  key: string
}

let supabaseState: SupabaseState | null = null
const memoryStore = new Map<string, MemoryBlobRecord>()

function timestamp() {
  return new Date().toISOString()
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause ?? null,
    }
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch {
      return { ...error }
    }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  return { message: 'Unknown error', value: error }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '')
}

function encodePathForUrl(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function cacheControlFromSeconds(seconds?: number): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined
  const safeSeconds = Math.max(0, Math.trunc(seconds))
  return `public, max-age=${safeSeconds}`
}

function applyRandomSuffix(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('.')
  const suffix = `-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
  if (index === -1) {
    return `${normalized}${suffix}`
  }
  const base = normalized.slice(0, index)
  const ext = normalized.slice(index)
  return `${base}${suffix}${ext}`
}

function buildProxyUrl(path: string): string {
  const encoded = encodePathForUrl(normalizePath(path))
  const override = getSecret('PUBLIC_STORAGE_BASE_URL')
  if (override && /^https?:/i.test(override)) {
    try {
      const base = new URL(override)
      const url = new URL(encoded, base.toString())
      return url.toString()
    } catch (error) {
      logBlobDiagnostic('error', 'proxy-url:override-invalid', {
        overridePreview: override.slice(0, 120),
        error: serializeError(error),
      })
    }
  } else if (override && override.trim()) {
    const trimmed = override.trim().replace(/\/+$|^\/+/, '')
    return `/${trimmed}/${encoded}`.replace(/\/+/, '/')
  }
  return `${BLOB_PROXY_PREFIX}${encoded}`
}

function extractPathFromUrl(input: string): string | null {
  if (!input) return null
  if (input.startsWith('data:')) return null
  if (input.startsWith(BLOB_PROXY_PREFIX)) {
    return decodeURIComponent(input.slice(BLOB_PROXY_PREFIX.length))
  }
  if (/^https?:/i.test(input)) {
    try {
      const url = new URL(input)
      if (url.pathname.startsWith(BLOB_PROXY_PREFIX)) {
        return decodeURIComponent(url.pathname.slice(BLOB_PROXY_PREFIX.length))
      }
      const baseOverride = getSecret('PUBLIC_STORAGE_BASE_URL')
      if (baseOverride) {
        try {
          const base = new URL(baseOverride)
          if (base.origin === url.origin && url.pathname.startsWith(base.pathname)) {
            const relative = url.pathname.slice(base.pathname.length).replace(/^\/+/, '')
            return decodeURIComponent(relative)
          }
        } catch {
          // ignore
        }
      }
    } catch {
      return null
    }
  }
  return normalizePath(input)
}

function ensureSupabase(): SupabaseState {
  if (supabaseState) {
    return supabaseState
  }
  assertBlobEnv()
  const url = requireSecret('SUPABASE_URL').replace(/\/+$/, '')
  const key = requireSecret('SUPABASE_SERVICE_ROLE_KEY')
  const bucket = requireSecret('SUPABASE_STORAGE_BUCKET')
  supabaseState = { url, key, bucket }
  logBlobDiagnostic('log', 'supabase:init', { bucket })
  return supabaseState
}

function resolveMode(): StorageMode {
  try {
    return getStorageMode()
  } catch (error) {
    logBlobDiagnostic('error', 'storage-mode:resolve-failed', { error: serializeError(error) })
    throw error instanceof Error
      ? error
      : new Error('Unable to resolve storage mode; verify STORAGE_MODE environment variable configuration.')
  }
}

async function supabaseUpload(state: SupabaseState, path: string, body: Buffer, contentType: string, cacheControl?: string) {
  const endpoint = `${state.url}/storage/v1/object/${encodePathForUrl(`${state.bucket}/${normalizePath(path)}`)}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${state.key}`,
    apikey: state.key,
    'Content-Type': contentType,
  }
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase upload failed with status ${res.status}: ${text.slice(0, 200)}`)
  }
}

async function supabaseDownload(state: SupabaseState, path: string) {
  const endpoint = `${state.url}/storage/v1/object/${encodePathForUrl(`${state.bucket}/${normalizePath(path)}`)}`
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${state.key}`,
      apikey: state.key,
    },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase download failed with status ${res.status}: ${text.slice(0, 200)}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    cacheControl: res.headers.get('cache-control') || undefined,
    uploadedAt: res.headers.get('last-modified') || undefined,
    etag: res.headers.get('etag') || undefined,
    size: Number(res.headers.get('content-length') || arrayBuffer.byteLength) || arrayBuffer.byteLength,
  }
}

async function supabaseDelete(state: SupabaseState, path: string) {
  const endpoint = `${state.url}/storage/v1/object/${encodePathForUrl(`${state.bucket}/${normalizePath(path)}`)}`
  const res = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${state.key}`,
      apikey: state.key,
    },
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase delete failed with status ${res.status}: ${text.slice(0, 200)}`)
  }
}

async function supabaseList(state: SupabaseState, prefix: string, limit: number) {
  const endpoint = `${state.url}/storage/v1/object/list/${encodeURIComponent(state.bucket)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.key}`,
      apikey: state.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: prefix || '', limit: Math.max(limit, 1), offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase list failed with status ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json().catch(() => null)
  if (!json || typeof json !== 'object' || !Array.isArray((json as any).data)) {
    return []
  }
  return (json as any).data as Array<{
    name: string
    id?: string
    updated_at?: string
    created_at?: string
    metadata?: { size?: number }
    last_accessed_at?: string
  }>
}

function buildListedBlob(pathname: string, record: Partial<MemoryBlobRecord> = {}): ListedBlob {
  const proxy = buildProxyUrl(pathname)
  return {
    pathname,
    url: proxy,
    downloadUrl: proxy,
    uploadedAt: record.uploadedAt,
    size: record.size,
  }
}

export async function putBlobFromBuffer(
  path: string,
  buf: Buffer,
  contentType: string,
  options: PutBlobOptions = {},
) {
  const mode = resolveMode()
  let targetPath = normalizePath(path)
  if (options.addRandomSuffix) {
    targetPath = applyRandomSuffix(targetPath)
  }
  const cacheControl = cacheControlFromSeconds(options.cacheControlMaxAge)
  logBlobDiagnostic('log', 'put:start', {
    path: targetPath,
    mode,
    contentType,
    cacheControl,
  })

  if (mode === 'memory') {
    const stored: MemoryBlobRecord = {
      buffer: Buffer.from(buf),
      contentType,
      uploadedAt: timestamp(),
      size: buf.byteLength,
      cacheControl,
    }
    memoryStore.set(targetPath, stored)
    const proxy = buildProxyUrl(targetPath)
    logBlobDiagnostic('log', 'put:memory:success', { path: targetPath, size: stored.size })
    return { url: proxy, downloadUrl: proxy }
  }

  const state = ensureSupabase()
  try {
    await supabaseUpload(state, targetPath, buf instanceof Buffer ? buf : Buffer.from(buf), contentType, cacheControl)
  } catch (error) {
    logBlobDiagnostic('error', 'put:supabase:failed', {
      path: targetPath,
      bucket: state.bucket,
      error: serializeError(error),
    })
    throw new Error(error instanceof Error ? error.message : 'Failed to upload blob to Supabase.')
  }
  const proxy = buildProxyUrl(targetPath)
  logBlobDiagnostic('log', 'put:supabase:success', { path: targetPath, bucket: state.bucket })
  return { url: proxy, downloadUrl: proxy }
}

function filterByCursor(blobs: ListedBlob[], limit: number, cursor?: string) {
  const sorted = [...blobs].sort((a, b) => a.pathname.localeCompare(b.pathname))
  let startIndex = 0
  if (cursor) {
    const cursorIndex = sorted.findIndex((entry) => entry.pathname > cursor)
    startIndex = cursorIndex === -1 ? sorted.length : cursorIndex
  }
  const slice = sorted.slice(startIndex, startIndex + limit)
  const hasMore = startIndex + slice.length < sorted.length
  const nextCursor = hasMore && slice.length ? slice[slice.length - 1].pathname : undefined
  return { slice, hasMore, nextCursor }
}

async function listMemoryBlobs(prefix: string, limit: number, cursor?: string): Promise<ListBlobResult> {
  const normalizedPrefix = normalizePath(prefix)
  const matches: ListedBlob[] = []
  for (const [pathname, record] of memoryStore.entries()) {
    if (!normalizedPrefix || pathname.startsWith(normalizedPrefix)) {
      matches.push(
        buildListedBlob(pathname, {
          uploadedAt: record.uploadedAt,
          size: record.size,
        }),
      )
    }
  }
  const { slice, hasMore, nextCursor } = filterByCursor(matches, limit, cursor)
  logBlobDiagnostic('log', 'list:memory:complete', {
    prefix: normalizedPrefix,
    count: slice.length,
    hasMore,
  })
  return { blobs: slice, hasMore, cursor: nextCursor }
}

async function listSupabaseBlobs(prefix: string, limit: number, cursor?: string): Promise<ListBlobResult> {
  const state = ensureSupabase()
  const normalizedPrefix = normalizePath(prefix)
  logBlobDiagnostic('log', 'list:supabase:start', {
    prefix: normalizedPrefix,
    bucket: state.bucket,
  })
  try {
    const objects = await supabaseList(state, normalizedPrefix, Math.max(limit, 1000))
    const blobs: ListedBlob[] = (objects || []).map((entry) => {
      const pathname = normalizedPrefix
        ? `${normalizedPrefix.replace(/\/+$/, '')}/${entry.name}`.replace(/\/+/, '/').replace(/^\/+/, '')
        : normalizePath(entry.name)
      return {
        pathname,
        url: buildProxyUrl(pathname),
        downloadUrl: buildProxyUrl(pathname),
        uploadedAt: entry.updated_at || entry.created_at || undefined,
        size: typeof entry.metadata?.size === 'number' ? entry.metadata.size : undefined,
      }
    })
    const filtered = normalizedPrefix
      ? blobs.filter((entry) => entry.pathname.startsWith(normalizedPrefix))
      : blobs
    const { slice, hasMore, nextCursor } = filterByCursor(filtered, limit, cursor)
    logBlobDiagnostic('log', 'list:supabase:complete', {
      prefix: normalizedPrefix,
      bucket: state.bucket,
      count: slice.length,
      hasMore,
    })
    return { blobs: slice, hasMore, cursor: nextCursor }
  } catch (error) {
    logBlobDiagnostic('error', 'list:supabase:failed', {
      prefix: normalizedPrefix,
      bucket: state.bucket,
      error: serializeError(error),
    })
    throw new Error(error instanceof Error ? error.message : 'Failed to list Supabase storage objects.')
  }
}

export async function listBlobs(options: ListCommandOptions = {}): Promise<ListBlobResult> {
  const limit = options.limit && Number.isFinite(options.limit) ? Math.max(1, options.limit) : 100
  const prefix = options.prefix ?? ''
  const cursor = options.cursor
  const mode = resolveMode()
  logBlobDiagnostic('log', 'list:start', { prefix: normalizePath(prefix), limit, cursor, mode })
  if (mode === 'memory') {
    return listMemoryBlobs(prefix, limit, cursor)
  }
  return listSupabaseBlobs(prefix, limit, cursor)
}

export async function deleteBlobsByPrefix(prefix: string) {
  const normalized = normalizePath(prefix)
  const mode = resolveMode()
  logBlobDiagnostic('log', 'delete-prefix:start', { prefix: normalized, mode })
  if (mode === 'memory') {
    let removed = 0
    for (const key of Array.from(memoryStore.keys())) {
      if (!normalized || key.startsWith(normalized)) {
        memoryStore.delete(key)
        removed += 1
      }
    }
    logBlobDiagnostic('log', 'delete-prefix:memory:complete', { prefix: normalized, removed })
    return removed
  }
  const state = ensureSupabase()
  const { blobs } = await listSupabaseBlobs(normalized, 1000)
  let removed = 0
  for (const blob of blobs) {
    try {
      await supabaseDelete(state, blob.pathname)
      removed += 1
    } catch (error) {
      logBlobDiagnostic('error', 'delete-prefix:supabase:failed', {
        prefix: normalized,
        path: blob.pathname,
        bucket: state.bucket,
        error: serializeError(error),
      })
      throw new Error(error instanceof Error ? error.message : 'Failed to delete Supabase objects.')
    }
  }
  logBlobDiagnostic('log', 'delete-prefix:supabase:complete', { prefix: normalized, removed })
  return removed
}

export async function deleteBlob(path: string) {
  const normalized = normalizePath(path)
  const mode = resolveMode()
  logBlobDiagnostic('log', 'delete:start', { path: normalized, mode })
  if (mode === 'memory') {
    const existed = memoryStore.delete(normalized)
    logBlobDiagnostic('log', 'delete:memory:complete', { path: normalized, existed })
    return existed
  }
  const state = ensureSupabase()
  try {
    await supabaseDelete(state, normalized)
    logBlobDiagnostic('log', 'delete:supabase:complete', { path: normalized })
    return true
  } catch (error) {
    logBlobDiagnostic('error', 'delete:supabase:failed', {
      path: normalized,
      bucket: state.bucket,
      error: serializeError(error),
    })
    throw new Error(error instanceof Error ? error.message : 'Failed to delete Supabase object.')
  }
}

export async function readBlob(pathOrUrl: string): Promise<ReadBlobResult | null> {
  const mode = resolveMode()
  const normalizedPath = extractPathFromUrl(pathOrUrl)
  if (!normalizedPath) {
    logBlobDiagnostic('log', 'read:skipped', { path: pathOrUrl, reason: 'unresolvable' })
    return null
  }
  logBlobDiagnostic('log', 'read:start', { path: normalizedPath, mode })

  if (mode === 'memory') {
    const record = memoryStore.get(normalizedPath)
    if (!record) {
      logBlobDiagnostic('log', 'read:memory:miss', { path: normalizedPath })
      return null
    }
    logBlobDiagnostic('log', 'read:memory:hit', { path: normalizedPath, size: record.size })
    return {
      buffer: Buffer.from(record.buffer),
      contentType: record.contentType,
      cacheControl: record.cacheControl,
      uploadedAt: record.uploadedAt,
      size: record.size,
    }
  }

  const state = ensureSupabase()
  try {
    const record = await supabaseDownload(state, normalizedPath)
    if (!record) {
      logBlobDiagnostic('log', 'read:supabase:empty', { path: normalizedPath })
      return null
    }
    logBlobDiagnostic('log', 'read:supabase:success', { path: normalizedPath, size: record.size })
    return record
  } catch (error) {
    logBlobDiagnostic('error', 'read:supabase:failed', {
      path: normalizedPath,
      bucket: state.bucket,
      error: serializeError(error),
    })
    throw new Error(error instanceof Error ? error.message : 'Failed to download Supabase object.')
  }
}

export function getBlobToken(): string | undefined {
  try {
    const mode = getStorageMode()
    return mode
  } catch (error) {
    logBlobDiagnostic('error', 'token:resolve-failed', { error: serializeError(error) })
    return undefined
  }
}

export function clearFallbackBlobs() {
  memoryStore.clear()
  logBlobDiagnostic('log', 'memory:cleared')
}

export type BlobHealthReport = {
  ok: boolean
  mode: BlobStorageMode
  reason?: string | null
  bucket?: string | null
}

export async function blobHealth(): Promise<BlobHealthReport> {
  try {
    const mode = resolveMode()
    if (mode === 'memory') {
      return { ok: true, mode, reason: 'memory storage active', bucket: null }
    }
    const state = ensureSupabase()
    const endpoint = `${state.url}/storage/v1/object/list/${encodeURIComponent(state.bucket)}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.key}`,
        apikey: state.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: '', limit: 1 }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logBlobDiagnostic('error', 'health:supabase:error', {
        bucket: state.bucket,
        status: res.status,
        response: text.slice(0, 200),
      })
      return { ok: false, mode, reason: text || `status ${res.status}`, bucket: state.bucket }
    }
    logBlobDiagnostic('log', 'health:supabase:success', { bucket: state.bucket })
    return { ok: true, mode, bucket: state.bucket }
  } catch (error) {
    logBlobDiagnostic('error', 'health:failed', { error: serializeError(error) })
    return {
      ok: false,
      mode: 'supabase',
      reason: error instanceof Error ? error.message : 'unknown error',
      bucket: null,
    }
  }
}

export function getBlobEnvironment() {
  try {
    const mode = resolveMode()
    if (mode === 'memory') {
      return {
        provider: 'memory',
        configured: true as const,
        bucket: null,
        diagnostics: describeBlobEnvSnapshot(),
        error: null,
      }
    }
    const state = ensureSupabase()
    return {
      provider: 'supabase',
      configured: true as const,
      bucket: state.bucket,
      store: state.bucket,
      diagnostics: describeBlobEnvSnapshot(),
      error: null,
    }
  } catch (error) {
    logBlobDiagnostic('error', 'environment:failed', { error: serializeError(error) })
    return {
      provider: 'unknown',
      configured: false as const,
      bucket: null,
      diagnostics: describeBlobEnvSnapshot(),
      error,
    }
  }
}

type HeaderLike =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>
  | Headers
  | null
  | undefined

export function primeStorageContextFromHeaders(_headers: HeaderLike): boolean {
  logBlobDiagnostic('log', 'prime-context:skipped', {
    note: 'Supabase storage does not require Vercel context headers.',
  })
  return false
}

