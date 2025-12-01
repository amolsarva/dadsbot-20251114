import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/data'
import { getBlobEnvironment, primeStorageContextFromHeaders } from '@/lib/blob'
import { resolveDefaultNotifyEmailServer } from '@/lib/default-notify-email.server'
import { getSecret } from '@/lib/secrets.server'

const formatEnvSummary = () => ({
  DEFAULT_NOTIFY_EMAIL: getSecret('DEFAULT_NOTIFY_EMAIL') ? '[set]' : null,
  storage: (() => {
    try {
      const env = getBlobEnvironment()
      return {
        provider: env.provider,
        bucket: env.bucket ?? null,
        configured: env.configured,
        diagnostics: env.diagnostics,
        error: env.error ? String(env.error) : null,
      }
    } catch (error: any) {
      return {
        provider: 'unknown',
        configured: false,
        diagnostics: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })(),
})

const logDiagnostic = (level: 'log' | 'error', message: string, detail?: unknown) => {
  const timestamp = new Date().toISOString()
  const scope = '[api/session/start]'
  const payload = { env: formatEnvSummary(), detail }
  if (level === 'error') {
    console.error(`[diagnostic] ${timestamp} ${scope} ${message}`, payload)
  } else {
    console.log(`[diagnostic] ${timestamp} ${scope} ${message}`, payload)
  }
}

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  primeStorageContextFromHeaders(req.headers)
  let payload: any = {}
  try {
    const raw = await req.text()
    if (raw && raw.trim().length) {
      payload = JSON.parse(raw)
    }
  } catch (error) {
    logDiagnostic('error', 'Failed to parse session start payload as JSON.', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON payload for session start.' },
      { status: 400 },
    )
  }

  const rawEmail = typeof payload?.email === 'string' ? payload.email.trim() : ''
  const emailsEnabled = payload?.emailsEnabled !== false
  const defaultEmail = resolveDefaultNotifyEmailServer()
  const targetEmail = emailsEnabled ? rawEmail || defaultEmail : ''
  const userHandle =
    typeof payload?.userHandle === 'string'
      ? payload.userHandle
      : typeof payload?.user_handle === 'string'
      ? payload.user_handle
      : null

  const envSummary = formatEnvSummary()
  if (!envSummary.storage?.configured) {
    const message = 'Storage environment is not configured; cannot create a durable session.'
    logDiagnostic('error', message, { envSummary })
    return NextResponse.json(
      {
        ok: false,
        error: message,
        detail:
          'Set STORAGE_MODE and provider secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET) before attempting to start a session.',
      },
      { status: 500 },
    )
  }

  try {
    logDiagnostic('log', 'Attempting to create a session.', {
      emailsEnabled,
      hasEmail: Boolean(targetEmail),
      userHandle,
      envSummary,
    })
    const session = await createSession({
      email_to: targetEmail,
      user_handle: userHandle,
    })
    if (!session?.id) {
      const message = 'Session creation succeeded without returning an identifier.'
      logDiagnostic('error', message, { session })
      return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }
    logDiagnostic('log', 'Session created successfully.', { sessionId: session.id })
    return NextResponse.json({ id: session.id, email: session.email_to, emailsEnabled })
  } catch (error: any) {
    const message =
      typeof error?.message === 'string' && error.message.length
        ? error.message
        : 'Session creation failed.'
    logDiagnostic('error', message, {
      error: error instanceof Error ? { name: error.name, stack: error.stack } : error,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
