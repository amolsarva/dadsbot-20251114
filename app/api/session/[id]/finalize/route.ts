import { NextRequest, NextResponse } from 'next/server'
import { finalizeSession } from '@/lib/data'
import { primeNetlifyBlobContextFromHeaders } from '@/lib/blob'
import { z } from 'zod'

const schema = z.object({
  clientDurationMs: z.number().nonnegative().default(0),
  sessionAudioUrl: z.string().min(1).optional(),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  primeNetlifyBlobContextFromHeaders(req.headers)
  let payload: unknown
  try {
    payload = await req.json()
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'invalid_json' },
      { status: 400 },
    )
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const { clientDurationMs, sessionAudioUrl } = parsed.data

  try {
    const result = await finalizeSession(params.id, { clientDurationMs, sessionAudioUrl })
    return NextResponse.json(result)
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : ''
    if (/session not found/i.test(message)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'session_not_found' })
    }
    return NextResponse.json({ ok: false, error: message || 'bad_request' }, { status: 500 })
  }
}
