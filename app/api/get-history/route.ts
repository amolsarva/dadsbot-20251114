import { NextRequest, NextResponse } from 'next/server'
import { getBlobEnvironment, listBlobs, primeStorageContextFromHeaders } from '@/lib/blob'

type HistoryEntry = {
  sessionId: string
  startedAt: string | null
  endedAt: string | null
  totals: { turns: number; durationMs: number | null }
  manifestUrl: string | null
  turns: { url: string; uploadedAt: string; name: string }[]
  allTurns?: { turn: number; audio: string | null; manifest: string; transcript: string }[]
}

export async function GET(req: NextRequest) {
  primeStorageContextFromHeaders(req.headers)
  try {
    const storageEnv = getBlobEnvironment()
    if (!storageEnv.configured) {
      return NextResponse.json({ items: [] })
    }

    const url = new URL(req.url)
    const page = Number(url.searchParams.get('page') || '1')
    const limit = Number(url.searchParams.get('limit') || '10')

    const prefix = 'sessions/'
    const { blobs } = await listBlobs({ prefix, limit: 2000 })
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
        const uploadedAtValue =
          blob.uploadedAt instanceof Date
            ? blob.uploadedAt.toISOString()
            : typeof blob.uploadedAt === 'string'
            ? blob.uploadedAt
            : new Date().toISOString()
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
          const resp = await fetch(turn.url)
          const json = await resp.json()
          allTurns.push({
            turn: Number(json.turn) || 0,
            audio: json.userAudioUrl || null,
            manifest: turn.url,
            transcript: typeof json.transcript === 'string' ? json.transcript : '',
          })
        } catch {
          // ignore failures per legacy behavior
        }
      }
      entry.allTurns = allTurns
      return entry
    }

    const items: HistoryEntry[] = []
    for (const entry of paged) {
      items.push(await enrich(entry))
    }

    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ items: [] })
  }
}
