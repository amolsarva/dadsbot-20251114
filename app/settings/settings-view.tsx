"use client"
import { useEffect, useState } from 'react'
import {
  ACTIVE_USER_HANDLE_STORAGE_KEY,
  EMAIL_ENABLED_STORAGE_BASE_KEY,
  EMAIL_STORAGE_BASE_KEY,
  normalizeHandle,
  scopedStorageKey,
} from '@/lib/user-scope'
import { readDefaultNotifyEmailClient } from '@/lib/default-notify-email.client'

type SettingsViewProps = {
  userHandle?: string
}

export function SettingsView({ userHandle }: SettingsViewProps) {
  const normalizedPropHandle = normalizeHandle(userHandle)
  const [email, setEmail] = useState('')
  const [sendEmails, setSendEmails] = useState(true)
  const [saved, setSaved] = useState(false)
  const [activeHandle, setActiveHandle] = useState<string | undefined>(normalizedPropHandle)

  useEffect(() => {
    if (typeof window === 'undefined') {
      setEmail(readDefaultNotifyEmailClient())
      setSendEmails(true)
      setActiveHandle(undefined)
      return
    }

    try {
      const storedHandle = normalizedPropHandle
        ? normalizedPropHandle
        : normalizeHandle(window.localStorage.getItem(ACTIVE_USER_HANDLE_STORAGE_KEY))
      if (normalizedPropHandle) {
        window.localStorage.setItem(ACTIVE_USER_HANDLE_STORAGE_KEY, normalizedPropHandle)
      }
      setActiveHandle(storedHandle)

      const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, storedHandle)
      setEmail(window.localStorage.getItem(emailKey) || readDefaultNotifyEmailClient())
      const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, storedHandle)
      const raw = window.localStorage.getItem(enabledKey)
      setSendEmails(raw === null ? true : raw !== 'false')
    } catch (error) {
      console.error(
        `[diagnostic] ${new Date().toISOString()} settings:default-email:storage-error ${JSON.stringify({
          error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
          clientSummary:
            typeof window === 'undefined'
              ? { origin: '__no_window__', pathname: '__no_window__' }
              : { origin: window.location.origin, pathname: window.location.pathname },
        })}`,
      )
      setEmail(readDefaultNotifyEmailClient())
      setSendEmails(true)
      setActiveHandle(undefined)
    }
  }, [normalizedPropHandle])

  useEffect(() => {
    setSaved(false)
  }, [email, sendEmails])

  return (
    <main>
      <div className="panel-card settings-card">
        <h2 className="page-heading">Settings</h2>
        {activeHandle && (
          <p className="page-subtext">
            Active account: <span className="highlight">@{activeHandle}</span>
          </p>
        )}
        <div className="settings-field">
          <label htmlFor="notify-email">Default notify email</label>
          <input id="notify-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={sendEmails}
            onChange={(e) => setSendEmails(e.target.checked)}
          />
          <span>Send session summaries by email</span>
        </label>
        <div className="settings-actions">
          <button
            onClick={() => {
              const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, activeHandle)
              const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, activeHandle)
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(emailKey, email)
                window.localStorage.setItem(enabledKey, sendEmails ? 'true' : 'false')
              }
              setSaved(true)
            }}
          >
            Save
          </button>
          {saved && <span className="status-note">Saved.</span>}
        </div>
      </div>
    </main>
  )
}

export default SettingsView
