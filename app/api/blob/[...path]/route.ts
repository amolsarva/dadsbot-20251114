import { NextRequest, NextResponse } from 'next/server'
import {
  BLOB_PROXY_PREFIX,
  deleteBlob,
  primeStorageContextFromHeaders,
  putBlobFromBuffer,
  readBlob,
} from '@/lib/blob'
import { jsonErrorResponse } from '@/lib/api-error'
import { logBlobDiagnostic } from '@/utils/blob-env'

const ROUTE_NAME = 'app/api/blob'

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
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

function collectRelevantHeaderKeys(headers: Headers): string[] {
  const keys: string[] = []
  for (const key of headers.keys()) {
    if (key.toLowerCase().startsWith('x-vercel')) {
      keys.push(key)
    }
  }
  return keys
}

function logRouteEvent(
  level: 'log' | 'error',
  event: string,
  payload?: Record<string, unknown>,
) {
  logBlobDiagnostic(level, event, {
    route: ROUTE_NAME,
    ...(payload ?? {}),
  })
}

function extractPath(params: { path?: string[] | string }): string {
  const raw = params?.path
  if (!raw) return ''
  if (Array.isArray(raw)) return raw.join('/')
  return raw
}

function buildFilename(path: string): string {
  const segments = normalizePath(path).split('/')
  const raw = segments[segments.length - 1] || 'download'
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized || 'download'
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '')
}

async function handleBlobRequest(path: string, download: boolean, includeBody: boolean) {
  if (!path) {
    logRouteEvent('error', 'blob-route:read:missing-path', {
      note: 'Blob request missing required path parameter',
    })
    return NextResponse.json({ ok: false, reason: 'missing path' }, { status: 400 })
  }

  logRouteEvent('log', 'blob-route:read:start', {
    path,
    download,
    includeBody,
  })

  let record
  try {
    record = await readBlob(path)
  } catch (error) {
    logRouteEvent('error', 'blob-route:read:failed', {
      path,
      download,
      includeBody,
      error: serializeError(error),
    })
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.trim().length
        ? (error as any).message
        : 'failed to read blob'
    return jsonErrorResponse(error, fallbackMessage, undefined, { reason: fallbackMessage })
  }
  if (!record) {
    logRouteEvent('log', 'blob-route:read:not-found', {
      path,
      download,
      includeBody,
    })
    return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 })
  }

  const filename = buildFilename(path)
  const disposition = download ? 'attachment' : 'inline'
  const body = includeBody ? record.buffer : null
  const response = new NextResponse(body)
  response.headers.set('Content-Type', record.contentType)
  if (record.cacheControl) {
    response.headers.set('Cache-Control', record.cacheControl)
  } else {
    response.headers.set('Cache-Control', 'public, max-age=60')
  }
  response.headers.set('Content-Disposition', `${disposition}; filename="${filename}"`)
  if (record.etag) {
    response.headers.set('ETag', record.etag)
  }
  if (record.uploadedAt) {
    const lastModified = new Date(record.uploadedAt)
    if (!Number.isNaN(lastModified.valueOf())) {
      response.headers.set('Last-Modified', lastModified.toUTCString())
    }
  }
  if (typeof record.size === 'number' && Number.isFinite(record.size)) {
    response.headers.set('Content-Length', String(Math.max(0, Math.trunc(record.size))))
  }
  const normalizedPath = normalizePath(path)
  response.headers.set('X-Blob-Path', `${BLOB_PROXY_PREFIX}${encodeURIComponent(normalizedPath)}`)
  logRouteEvent('log', 'blob-route:read:success', {
    path,
    download,
    includeBody,
    contentType: record.contentType,
    size: typeof record.size === 'number' ? record.size : null,
  })
  return response
}

function primeContext(req: Request | NextRequest) {
  const method = (req as any)?.method || 'UNKNOWN'
  const url = typeof (req as any)?.url === 'string' ? (req as any).url : null
  const headerKeys = collectRelevantHeaderKeys(req.headers as Headers)
  logRouteEvent('log', 'blob-route:prime-context:start', {
    method,
    url,
    headerKeys,
  })
  try {
    const primed = primeStorageContextFromHeaders(req.headers)
    logRouteEvent('log', 'blob-route:prime-context:result', {
      method,
      url,
      headerKeys,
      primed,
    })
    return primed
  } catch (error) {
    logRouteEvent('error', 'blob-route:prime-context:failed', {
      method,
      url,
      headerKeys,
      error: serializeError(error),
    })
    throw error
  }
}

export async function GET(req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(req)
  const path = extractPath(params)
  const download = req.nextUrl.searchParams.has('download')
  return handleBlobRequest(path, download, true)
}

export async function HEAD(req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(req)
  const path = extractPath(params)
  const download = req.nextUrl.searchParams.has('download')
  return handleBlobRequest(path, download, false)
}

export async function PUT(req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(req)
  const path = extractPath(params)
  if (!path) {
    logRouteEvent('error', 'blob-route:put:missing-path', {
      method: 'PUT',
      url: req.url,
    })
    return NextResponse.json({ ok: false, reason: 'missing path' }, { status: 400 })
  }

  const arrayBuffer = await req.arrayBuffer()
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    logRouteEvent('error', 'blob-route:put:missing-body', {
      method: 'PUT',
      url: req.url,
      path,
    })
    return NextResponse.json({ ok: false, reason: 'missing body' }, { status: 400 })
  }

  const contentType = req.headers.get('content-type') || 'application/octet-stream'
  const cacheControlHeader = req.headers.get('cache-control') || undefined
  const explicitMaxAge = req.headers.get('x-cache-control-max-age')

  logRouteEvent('log', 'blob-route:put:start', {
    path,
    contentType,
    cacheControlHeader: cacheControlHeader || null,
    explicitMaxAge: explicitMaxAge || null,
    bodyBytes: arrayBuffer.byteLength,
  })

  let cacheControlMaxAge: number | undefined
  if (explicitMaxAge) {
    const parsed = Number.parseInt(explicitMaxAge, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      cacheControlMaxAge = parsed
    }
  } else if (cacheControlHeader) {
    const match = /max-age\s*=\s*(\d+)/i.exec(cacheControlHeader)
    if (match) {
      const parsed = Number.parseInt(match[1], 10)
      if (Number.isFinite(parsed) && parsed >= 0) {
        cacheControlMaxAge = parsed
      }
    }
  }

  const buffer = Buffer.from(arrayBuffer)

  try {
    const result = await putBlobFromBuffer(path, buffer, contentType, {
      cacheControlMaxAge,
    })
    logRouteEvent('log', 'blob-route:put:success', {
      path,
      contentType,
      cacheControlHeader: cacheControlHeader || null,
      cacheControlMaxAge: cacheControlMaxAge ?? null,
      url: result.url || null,
      downloadUrl: result.downloadUrl || null,
    })
    const response = NextResponse.json({ ok: true, url: result.url, downloadUrl: result.downloadUrl }, { status: 201 })
    if (result.url) {
      response.headers.set('Location', result.url)
    }
    if (cacheControlHeader) {
      response.headers.set('Cache-Control', cacheControlHeader)
    }
    return response
  } catch (error) {
    logRouteEvent('error', 'blob-route:put:failed', {
      path,
      contentType,
      cacheControlHeader: cacheControlHeader || null,
      cacheControlMaxAge: cacheControlMaxAge ?? null,
      error: serializeError(error),
    })
    const status =
      error && typeof error === 'object' && typeof (error as any).status === 'number' && (error as any).status >= 400
        ? (error as any).status
        : 500
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.length
        ? (error as any).message
        : 'failed to upload blob'
    return jsonErrorResponse(error, fallbackMessage, status, { reason: fallbackMessage })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(_req)
  const path = extractPath(params)
  if (!path) {
    logRouteEvent('error', 'blob-route:delete:missing-path', {
      method: 'DELETE',
      url: _req.url,
    })
    return NextResponse.json({ ok: false, reason: 'missing path' }, { status: 400 })
  }

  logRouteEvent('log', 'blob-route:delete:start', {
    path,
  })

  try {
    const deleted = await deleteBlob(path)
    if (!deleted) {
      logRouteEvent('log', 'blob-route:delete:not-found', {
        path,
      })
      return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 })
    }
    logRouteEvent('log', 'blob-route:delete:success', {
      path,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logRouteEvent('error', 'blob-route:delete:failed', {
      path,
      error: serializeError(error),
    })
    const status =
      error && typeof error === 'object' && typeof (error as any).status === 'number' && (error as any).status >= 400
        ? (error as any).status
        : 500
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.length
        ? (error as any).message
        : 'failed to delete blob'
    return jsonErrorResponse(error, fallbackMessage, status, { reason: fallbackMessage })
  }
}
