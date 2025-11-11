import 'server-only'
import { headers } from 'next/headers'
import { getSession } from '@/lib/data'
import { primeNetlifyBlobContextFromHeaders } from '@/lib/blob'

export default async function SessionPage({ params }: { params: { id: string } }) {
  primeNetlifyBlobContextFromHeaders(headers())
  const s = await getSession(params.id)
  if (!s) return <main>Not found.</main>
  const sessionManifestHref =
    s.artifacts?.manifest ?? s.artifacts?.session_manifest ?? undefined
  return (
    <main>
      <div className="panel-card session-card">
        <h2 className="page-heading">{s.title || 'Session'}</h2>
        <div className="page-subtext">{new Date(s.created_at).toLocaleString()}</div>
        <div className="page-subtext">
          Total entries: {s.total_turns}
          {Number.isFinite(s.duration_ms) && s.duration_ms > 0 && (
            <span> • Duration: {Math.round(s.duration_ms / 1000)}s</span>
          )}
        </div>
        {s.artifacts?.session_audio && (
          <div>
            <div className="tag-label">Session audio</div>
            <audio controls src={s.artifacts.session_audio} className="w-full max-w-xl" />
          </div>
        )}
        <div className="session-turns">
          {s.turns?.map((t) => (
            <div key={t.id} className="session-turn">
              <div className="session-turn-role">{t.role}</div>
              <div className="session-turn-text">{t.text}</div>
              {t.audio_blob_url && (
                <div className="session-turn-audio">
                  <div className="tag-label">Turn audio</div>
                  <audio controls src={t.audio_blob_url} className="w-full" />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="session-links">
          {s.artifacts?.transcript_txt && (
            <a className="link" href={s.artifacts.transcript_txt}>
              Transcript (txt)
            </a>
          )}
          {s.artifacts?.transcript_json && (
            <a className="link" href={s.artifacts.transcript_json}>
              Transcript (json)
            </a>
          )}
          {sessionManifestHref && (
            <a className="link" href={sessionManifestHref}>
              Session manifest
            </a>
          )}
          {s.artifacts?.session_audio && (
            <a className="link" href={s.artifacts.session_audio} target="_blank" rel="noreferrer">
              Session audio
            </a>
          )}
        </div>
      </div>
    </main>
  )
}
