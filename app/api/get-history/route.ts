import { NextRequest, NextResponse } from 'next/server'
import { getBlobEnvironment, listBlobs, primeStorageContextFromHeaders } from '@/lib/blob'
import { createDiagnosticLogger, serializeError } from '@/lib/logging'

type HistoryEntry = {
  sessionId: string
  startedAt: string | null
  endedAt: string | null
  totals: { turns: number; durationMs: number | null }
  manifestUrl: string | null
  turns: { url: string; uploadedAt: string; name: string }[]
  allTurns?: { turn: number; audio: string | null; manifest: string; transcript: string }[]
}

const log = createDiagnosticLogger('history:route')

function nowIso() {
  return new Date().toISOString()
}

function resolveUploadedAt(value: string | undefined) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  const fallback = nowIso()
  log('error', 'uploaded-at:fallback', { provided: value ?? null, fallback })
  return fallback
}

export async function GET(req: NextRequest) {
  primeStorageContextFromHeaders(req.headers)
  log('log', 'request:received', { url: req.url })
  try {
    const storageEnv = getBlobEnvironment()
    log('log', 'storage:environment', { configured: storageEnv.configured })
    if (!storageEnv.configured) {
      const payload = { reason: 'storage-not-configured' }
      log('error', 'storage:unconfigured', payload)
      return NextResponse.json({ items: [], error: payload.reason }, { status: 503 })
    }

    const url = new URL(req.url)
    const pageRaw = url.searchParams.get('page') || '1'
    const limitRaw = url.searchParams.get('limit') || '10'
    log('log', 'pagination:raw', { pageRaw, limitRaw })
    const page = Number(pageRaw)
    const limit = Number(limitRaw)
    if (!Number.isFinite(page) || !Number.isFinite(limit)) {
      const error = new Error('Invalid pagination parameters')
      log('error', 'pagination:invalid', {
        pageRaw,
        limitRaw,
        error: serializeError(error),
      })
      throw error
    }

    const prefix = 'sessions/'
    log('log', 'blobs:list:start', { prefix })
    const { blobs } = await listBlobs({ prefix, limit: 2000 })
    log('log', 'blobs:list:complete', { count: blobs.length })
    const sessions = new Map<string, HistoryEntry>()

    for (const blob of blobs) {
      const match = blob.pathname.match(/^sessions\/([^/]+)\/(.+)$/)
      if (!match) continue
      const id = match[1]
      const name = match[2]
      const entry =
        sessions.get(id) ||
        ({
          sessionId: id,
          startedAt: null,
          endedAt: null,
          totals: { turns: 0, durationMs: null },
          manifestUrl: null,
          turns: [],
        } as HistoryEntry)
      if (/^turn-\d+\.json$/.test(name)) {
        const uploadedAtValue = resolveUploadedAt(blob.uploadedAt)
        const urlToUse = blob.downloadUrl || blob.url
        if (!urlToUse) continue
        entry.turns.push({ url: urlToUse, uploadedAt: uploadedAtValue, name })
      }
      if (/^session-.+\.json$/.test(name)) {
        entry.manifestUrl = blob.downloadUrl || blob.url || null
      }
      sessions.set(id, entry)
    }

    const sorted = Array.from(sessions.values()).sort((a, b) => {
      const aTime = a.turns.length ? a.turns[a.turns.length - 1].uploadedAt : '0'
      const bTime = b.turns.length ? b.turns[b.turns.length - 1].uploadedAt : '0'
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })

    const paged = sorted.slice((page - 1) * limit, page * limit)

    async function enrich(entry: HistoryEntry): Promise<HistoryEntry> {
      entry.turns.sort((a, b) => a.name.localeCompare(b.name))
      entry.totals.turns = entry.turns.length
      const allTurns: HistoryEntry['allTurns'] = []
      for (const turn of entry.turns) {
        try {
          log('log', 'turn:fetch:start', { turnUrl: turn.url })
          const resp = await fetch(turn.url)
          if (!resp.ok) {
            const error = new Error(`Failed to fetch turn manifest: ${resp.status}`)
            log('error', 'turn:fetch:http-error', {
              turnUrl: turn.url,
              status: resp.status,
              statusText: resp.statusText,
              error: serializeError(error),
            })
            throw error
          }
          const json = await resp.json()
          allTurns.push({
            turn: Number(json.turn) || 0,
            audio: json.userAudioUrl || null,
            manifest: turn.url,
            transcript: typeof json.transcript === 'string' ? json.transcript : '',
          })
          log('log', 'turn:fetch:complete', { turnUrl: turn.url })
        } catch (error) {
          log('error', 'turn:fetch:failed', {
            turnUrl: turn.url,
            error: serializeError(error),
          })
        }
      }
      entry.allTurns = allTurns
      return entry
    }

    const items: HistoryEntry[] = []
    for (const entry of paged) {
      items.push(await enrich(entry))
    }

    log('log', 'response:success', { itemCount: items.length })
    return NextResponse.json({ items })
  } catch (error) {
    log('error', 'response:failure', { error: serializeError(error) })
    return NextResponse.json(
      { items: [], error: 'history-route-failure', detail: serializeError(error) },
      { status: 500 },
    )
  }
}
