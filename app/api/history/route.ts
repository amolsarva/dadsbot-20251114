import { NextResponse } from 'next/server'
import { listSessions, clearAllSessions, deleteSessionsByHandle } from '@/lib/data'
import { primeNetlifyBlobContextFromHeaders } from '@/lib/blob'
import { fetchStoredSessions } from '@/lib/history'
import { generateSessionTitle, SummarizableTurn } from '@/lib/session-title'
import { formatSessionTitleFallback } from '@/lib/fallback-texts'

export async function GET(request: Request) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const url = new URL(request.url)
  const handle = url.searchParams.get('handle')
  const items = await listSessions(handle)
  const rows = items.map(s => ({
    id: s.id,
    created_at: s.created_at,
    title:
      s.title ||
      generateSessionTitle(s.turns, {
        fallback: formatSessionTitleFallback(s.created_at),
      }) ||
      null,
    status: s.status,
    total_turns: s.total_turns,
    artifacts: {
      transcript_txt: s.artifacts?.transcript_txt || null,
      transcript_json: s.artifacts?.transcript_json || null,

      session_manifest: s.artifacts?.session_manifest || s.artifacts?.manifest || null,
      session_audio: s.artifacts?.session_audio || null,

    },
    manifestUrl: s.artifacts?.session_manifest || s.artifacts?.manifest || null,
    firstAudioUrl: s.turns?.find(t => t.audio_blob_url)?.audio_blob_url || null,
    sessionAudioUrl: s.artifacts?.session_audio || null,
  }))

  const { items: stored } = await fetchStoredSessions({ limit: 50, handle })
  for (const session of stored) {
    if (rows.some(r => r.id === session.sessionId)) continue
    const summarizableTurns: SummarizableTurn[] = (session.turns || []).flatMap((turn) =>
      [
        { role: 'user' as const, text: turn.transcript },
        turn.assistantReply ? { role: 'assistant' as const, text: turn.assistantReply } : null,
      ].filter(Boolean) as SummarizableTurn[],
    )

    rows.push({
      id: session.sessionId,
      created_at: session.startedAt || session.endedAt || new Date().toISOString(),
      title:
        generateSessionTitle(summarizableTurns, {
          fallback: formatSessionTitleFallback(session.startedAt || session.endedAt || new Date().toISOString()),
        }) ||
        null,
      status: 'completed',
      total_turns: session.totalTurns,
      artifacts: {
        transcript_txt: session.artifacts?.transcript_txt || null,
        transcript_json: session.artifacts?.transcript_json || null,

        session_manifest:
          session.artifacts?.session_manifest ||
          session.artifacts?.manifest ||
          session.manifestUrl ||
          null,
        session_audio: session.artifacts?.session_audio || null,
      },
      manifestUrl:
        session.artifacts?.session_manifest ||
        session.artifacts?.manifest ||
        session.manifestUrl ||
        null,

      firstAudioUrl: session.turns.find(t => Boolean(t.audio))?.audio || null,
      sessionAudioUrl: session.artifacts?.session_audio || null,
    })
  }

  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return NextResponse.json({ items: rows })
}

export async function DELETE(request: Request) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const url = new URL(request.url)
  const handle = url.searchParams.get('handle')
  if (handle) {
    const result = await deleteSessionsByHandle(handle)
    return NextResponse.json({ ok: true, deleted: result.deleted, items: [] })
  }
  await clearAllSessions()
  return NextResponse.json({ ok: true, items: [] })
}
