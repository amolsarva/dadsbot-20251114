import { NextRequest, NextResponse } from 'next/server'
import { finalizeSession } from '@/lib/data'
import { getBlobEnvironment, primeStorageContextFromHeaders } from '@/lib/blob'
import { z } from 'zod'

const schema = z.object({
  clientDurationMs: z.number().nonnegative().default(0),
  sessionAudioUrl: z.string().min(1).optional(),
})

const scope = '[api/session/finalize]'

const formatEnvSummary = () => {
  try {
    const env = getBlobEnvironment()
    return {
      provider: env.provider,
      configured: env.configured,
      bucket: env.bucket ?? null,
      diagnostics: env.diagnostics,
      error: env.error ? String(env.error) : null,
    }
  } catch (error: any) {
    return {
      provider: 'unknown',
      configured: false,
      bucket: null,
      diagnostics: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const log = (level: 'log' | 'error', step: string, detail?: unknown) => {
  const timestamp = new Date().toISOString()
  const payload = { env: formatEnvSummary(), detail }
  if (level === 'error') {
    console.error(`[diagnostic] ${timestamp} ${scope} ${step}`, payload)
  } else {
    console.log(`[diagnostic] ${timestamp} ${scope} ${step}`, payload)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  primeStorageContextFromHeaders(req.headers)
  let payload: unknown
  try {
    payload = await req.json()
  } catch (err: any) {
    log('error', 'payload:parse_failed', { sessionId: params.id, error: err?.message || err })
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'invalid_json' },
      { status: 400 },
    )
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    log('error', 'payload:invalid', { sessionId: params.id, issues: parsed.error.issues })
    return NextResponse.json(
      { ok: false, error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const { clientDurationMs, sessionAudioUrl } = parsed.data

  try {
    log('log', 'finalize:start', {
      sessionId: params.id,
      clientDurationMs,
      hasAudio: Boolean(sessionAudioUrl),
    })
    const result = await finalizeSession(params.id, { clientDurationMs, sessionAudioUrl })
    log('log', 'finalize:complete', { sessionId: params.id, resultSummary: { skipped: result.skipped, emailed: (result as any).emailed } })
    return NextResponse.json(result)
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : ''
    if (/session not found/i.test(message)) {
      log('error', 'finalize:missing-session', { sessionId: params.id, error: message })
      return NextResponse.json({ ok: true, skipped: true, reason: 'session_not_found' })
    }
    log('error', 'finalize:failed', {
      sessionId: params.id,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    })
    return NextResponse.json({ ok: false, error: message || 'bad_request' }, { status: 500 })
  }
}
