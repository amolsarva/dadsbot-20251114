import { NextRequest, NextResponse } from 'next/server'
import { appendTurn } from '@/lib/data'
import { getBlobEnvironment, primeStorageContextFromHeaders } from '@/lib/blob'
import { z } from 'zod'

const scope = '[api/session/turn]'

const formatEnvSummary = () => {
  const base = { provider: 'unknown', configured: false, bucket: null as string | null, error: null as string | null }
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
    return { ...base, error: error instanceof Error ? error.message : String(error) }
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
  const envSummary = formatEnvSummary()
  if (!envSummary.configured) {
    const message = 'Storage environment is not configured; cannot append session turns.'
    log('error', 'storage:unconfigured', { sessionId: params.id, envSummary })
    return NextResponse.json(
      {
        ok: false,
        error: message,
        detail:
          'Verify STORAGE_MODE and related provider credentials so session turns persist across function invocations.',
      },
      { status: 500 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
    log('log', 'payload:parsed', {
      sessionId: params.id,
      hasAudio: typeof (body as any)?.audio_blob_url === 'string',
    })
  } catch (error: any) {
    log('error', 'payload:parse_failed', { sessionId: params.id, error: error?.message || error })
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const schema = z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().default(''),
    audio_blob_url: z.string().url().optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    log('error', 'payload:invalid', { sessionId: params.id, issues: parsed.error.issues })
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400 })
  }

  try {
    const turn = await appendTurn(params.id, parsed.data as any)
    log('log', 'append:success', {
      sessionId: params.id,
      turnId: turn.id,
      role: turn.role,
      hasAudio: Boolean(turn.audio_blob_url),
    })
    return NextResponse.json(turn)
  } catch (error: any) {
    const message = error?.message ?? 'bad_request'
    const isMissing = typeof message === 'string' && /session not found/i.test(message)
    log('error', 'append:failed', {
      sessionId: params.id,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      envSummary,
      missing: isMissing,
    })
    return NextResponse.json(
      { error: message, reason: isMissing ? 'session_not_found' : 'bad_request' },
      { status: isMissing ? 404 : 400 },
    )
  }
}
