"use client"
import { useCallback, useEffect, useState } from 'react'
import {
  ACTIVE_USER_HANDLE_STORAGE_KEY,
  normalizeHandle,
} from '@/lib/user-scope'

type Row = {
  id: string
  created_at: string
  title: string | null
  status: string
  total_turns: number

  artifacts: {
    transcript_txt?: string | null
    transcript_json?: string | null
    session_manifest?: string | null
    session_audio?: string | null
  }

  manifestUrl?: string | null
  firstAudioUrl?: string | null
  sessionAudioUrl?: string | null
}

type HistoryViewProps = {
  userHandle?: string
}

export function HistoryView({ userHandle }: HistoryViewProps) {
  const normalizedPropHandle = normalizeHandle(userHandle)
  const [rows, setRows] = useState<Row[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [activeHandle, setActiveHandle] = useState<string | undefined>(normalizedPropHandle)

  const resolveHandle = useCallback(() => {
    if (normalizedPropHandle) return normalizedPropHandle
    if (typeof window === 'undefined') return undefined
    try {
      return normalizeHandle(window.localStorage.getItem(ACTIVE_USER_HANDLE_STORAGE_KEY))
    } catch {
      return undefined
    }
  }, [normalizedPropHandle])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (normalizedPropHandle) {
      window.localStorage.setItem(ACTIVE_USER_HANDLE_STORAGE_KEY, normalizedPropHandle)
      setActiveHandle(normalizedPropHandle)
    } else {
      setActiveHandle(resolveHandle())
    }
  }, [normalizedPropHandle, resolveHandle])

  const loadHistory = useCallback(async () => {
    try {
      const handle = resolveHandle()
      setActiveHandle(handle)
      const query = handle ? `?handle=${encodeURIComponent(handle)}` : ''
      const api = await (await fetch(`/api/history${query}`)).json()
      const serverRows: Row[] = api?.items || []
      const sorted = [...serverRows].sort((a, b) => {
        const aTime = new Date(a.created_at).getTime()
        const bTime = new Date(b.created_at).getTime()
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
        if (Number.isNaN(aTime)) return -1
        if (Number.isNaN(bTime)) return 1
        return bTime - aTime
      })
      setRows(sorted)
    } catch {
      setRows([])
    }
  }, [resolveHandle])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id)
      try {
        const resp = await fetch(`/api/history/${id}`, { method: 'DELETE' })
        if (resp.ok) {
          await loadHistory()
        }
      } finally {
        setDeletingId(null)
      }
    },
    [loadHistory],
  )

  const handleClearAll = useCallback(async () => {
    setClearingAll(true)
    try {
      const handle = resolveHandle()
      const query = handle ? `?handle=${encodeURIComponent(handle)}` : ''
      const resp = await fetch(`/api/history${query}`, { method: 'DELETE' })
      if (resp.ok) {
        setRows([])
      }
    } finally {
      setClearingAll(false)
    }
  }, [resolveHandle])

  const scopedSessionLink = useCallback(
    (id: string) => {
      const handle = activeHandle
      return handle ? `/u/${handle}/session/${id}` : `/session/${id}`
    },
    [activeHandle],
  )

  return (
    <main>
      <div className="panel-card">
        <h2 className="page-heading">Sessions</h2>
        {activeHandle && (
          <p className="page-subtext">
            Showing sessions saved for <span className="highlight">@{activeHandle}</span>
          </p>
        )}
        {rows.length === 0 ? (
          <div className="history-empty">
            <p className="font-medium">No interviews yet.</p>
            <p className="mt-1">
              Run a session from the home page or execute diagnostics to record a sample conversation. Your completed
              interviews will appear here once they are saved.
            </p>
          </div>
        ) : (
          <ul className="history-list">
            {rows.map((s) => (
              <li key={s.id} className="history-item">
                <div className="history-item-header">
                  <h3>{s.title || `Session from ${new Date(s.created_at).toLocaleString()}`}</h3>
                  <div className="history-meta">{new Date(s.created_at).toLocaleString()}</div>
                  <div className="history-meta">Turns: {s.total_turns} • Status: {s.status}</div>
                </div>
                <div className="history-item-body">
                  <div className="history-actions">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id || clearingAll}
                      className="link-button link-danger"
                      aria-label="Delete session"
                    >
                      {deletingId === s.id ? 'Deleting…' : '🗑 Remove'}
                    </button>
                    {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                      <audio
                        controls
                        src={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                        className="w-full"
                      >
                        <track kind="captions" />
                      </audio>
                    )}
                    {s.artifacts?.transcript_txt && (
                      <a className="link-button" href={s.artifacts.transcript_txt} target="_blank" rel="noreferrer">
                        Read transcript
                      </a>
                    )}
                    {s.manifestUrl && (
                      <a className="link-button" href={s.manifestUrl} target="_blank" rel="noreferrer">
                        View manifest
                      </a>
                    )}
                    {s.firstAudioUrl && (
                      <a className="link-button" href={s.firstAudioUrl} target="_blank" rel="noreferrer">
                        Initial audio
                      </a>
                    )}
                    {s.sessionAudioUrl && (
                      <a className="link-button" href={s.sessionAudioUrl} target="_blank" rel="noreferrer">
                        Full session audio
                      </a>
                    )}
                    <a className="link-button" href={scopedSessionLink(s.id)}>
                      Open session
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="history-footer">
          <button
            type="button"
            onClick={handleClearAll}
            className="link-button link-danger"
            disabled={clearingAll || rows.length === 0}
          >
            {clearingAll ? 'Clearing…' : 'Clear history'}
          </button>
        </div>
      </div>
    </main>
  )
}

export default HistoryView
