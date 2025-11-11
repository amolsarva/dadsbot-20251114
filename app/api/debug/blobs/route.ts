import { NextRequest, NextResponse } from 'next/server'
import { listBlobs, deleteBlobsByPrefix, primeStorageContextFromHeaders } from '@/lib/blob'
import { jsonErrorResponse } from '@/lib/api-error'
import { logBlobDiagnostic } from '@/utils/blob-env'

const ROUTE_NAME = 'app/api/debug/blobs'

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

function normalizePrefix(prefix: string | null): string {
  if (!prefix) return ''
  return prefix.replace(/^\/+/, '')
}

export async function GET(request: NextRequest) {
  try {
    logRouteEvent('log', 'debug-blob:get:start', {
      url: request.url,
    })
    primeStorageContextFromHeaders(request.headers)
    const url = new URL(request.url)
    const prefix = normalizePrefix(url.searchParams.get('prefix'))
    const limitParam = url.searchParams.get('limit')
    const cursor = url.searchParams.get('cursor') || undefined
    const limit = limitParam ? Math.min(200, Math.max(1, Number.parseInt(limitParam, 10) || 50)) : 50

    logRouteEvent('log', 'debug-blob:get:list', {
      prefix,
      limit,
      cursor: cursor || null,
    })

    const result = await listBlobs({ prefix, cursor, limit })
    logRouteEvent('log', 'debug-blob:get:success', {
      prefix,
      limit,
      cursor: cursor || null,
      count: Array.isArray(result?.blobs) ? result.blobs.length : null,
      hasMore: Boolean(result?.hasMore),
    })
    return NextResponse.json(result)
  } catch (error) {
    logRouteEvent('error', 'debug-blob:get:failed', {
      url: request.url,
      error: serializeError(error),
    })
    return jsonErrorResponse(error, 'Failed to list blobs')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    logRouteEvent('log', 'debug-blob:delete:start', {
      url: request.url,
    })
    primeStorageContextFromHeaders(request.headers)
    const url = new URL(request.url)
    const prefix = normalizePrefix(url.searchParams.get('prefix'))
    if (!prefix) {
      logRouteEvent('error', 'debug-blob:delete:missing-prefix', {
        url: request.url,
      })
      return NextResponse.json({ ok: false, reason: 'prefix required' }, { status: 400 })
    }
    logRouteEvent('log', 'debug-blob:delete:attempt', {
      prefix,
    })
    const deleted = await deleteBlobsByPrefix(prefix)
    logRouteEvent('log', 'debug-blob:delete:success', {
      prefix,
      deleted,
    })
    return NextResponse.json({ ok: true, deleted })
  } catch (error) {
    logRouteEvent('error', 'debug-blob:delete:failed', {
      url: request.url,
      error: serializeError(error),
    })
    return jsonErrorResponse(error, 'Failed to delete blobs')
  }
}
