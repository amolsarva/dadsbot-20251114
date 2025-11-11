import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { primeNetlifyBlobContextFromHeaders, putBlobFromBuffer } from '@/lib/blob'
import { jsonErrorResponse } from '@/lib/api-error'
import { logBlobDiagnostic } from '@/utils/blob-env'

const ROUTE_NAME = 'app/api/save-turn'

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch {
      return { ...error }
    }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  return { message: 'Unknown error', value: error }
}

function logRouteEvent(
  level: 'log' | 'error',
  event: string,
  payload?: Record<string, unknown>,
) {
  logBlobDiagnostic(level, event, {
    route: ROUTE_NAME,
    ...(payload ?? {}),
  })
}

const schema = z.object({
  sessionId: z.string().min(1),
  turn: z.union([z.number().int(), z.string()]),
  wav: z.string().min(1),
  mime: z.string().default('audio/webm'),
  duration_ms: z.union([z.number(), z.string()]).default(0),
  reply_text: z.string().default(''),
  transcript: z.string().default(''),
  provider: z.string().default('google'),
  assistant_wav: z.string().optional(),
  assistant_mime: z.string().default('audio/mpeg'),
  assistant_duration_ms: z.union([z.number(), z.string()]).default(0),
})

export async function POST(req: NextRequest) {
  logRouteEvent('log', 'save-turn:request:start', {
    url: req.url,
  })
  try {
    primeNetlifyBlobContextFromHeaders(req.headers)
  } catch (error) {
    logRouteEvent('error', 'save-turn:prime-context:failed', {
      url: req.url,
      error: serializeError(error),
    })
    throw error
  }
  try {
    const body = await req.json()
    logRouteEvent('log', 'save-turn:request:body-parsed', {
      keys: body && typeof body === 'object' ? Object.keys(body) : null,
    })
    const parsed = schema.parse(body)
    logRouteEvent('log', 'save-turn:request:validated', {
      sessionId: parsed.sessionId,
      turn: parsed.turn,
      hasAssistantAudio: Boolean(parsed.assistant_wav),
    })

    const turnNumber = typeof parsed.turn === 'string' ? Number(parsed.turn) : parsed.turn
    if (!Number.isFinite(turnNumber) || turnNumber <= 0) {
      throw new Error('Invalid turn number')
    }

    const buffer = Buffer.from(parsed.wav, 'base64')
    const pad = String(turnNumber).padStart(4, '0')
    const mime = parsed.mime || 'audio/webm'
    const extGuess = mime.split('/')[1]?.split(';')[0] || 'webm'
    const audioPath = `sessions/${parsed.sessionId}/user-${pad}.${extGuess}`
    const manifestPath = `sessions/${parsed.sessionId}/turn-${pad}.json`

    const userAudio = await putBlobFromBuffer(audioPath, buffer, mime, { access: 'public' })
    let assistantAudioUrl: string | null = null
    if (parsed.assistant_wav) {
      const assistantBuffer = Buffer.from(parsed.assistant_wav, 'base64')
      const assistantMime = parsed.assistant_mime || 'audio/mpeg'
      const assistantExt = assistantMime.split('/')[1]?.split(';')[0] || 'mp3'
      const assistantPath = `sessions/${parsed.sessionId}/assistant-${pad}.${assistantExt}`
      logRouteEvent('log', 'save-turn:upload:assistant-audio', {
        sessionId: parsed.sessionId,
        path: assistantPath,
        mime: assistantMime,
        bytes: assistantBuffer.byteLength,
      })
      const assistantBlob = await putBlobFromBuffer(assistantPath, assistantBuffer, assistantMime, { access: 'public' })
      assistantAudioUrl = assistantBlob.downloadUrl || assistantBlob.url
    }

    const manifestBody = {
      sessionId: parsed.sessionId,
      turn: turnNumber,
      createdAt: new Date().toISOString(),
      durationMs: Number(parsed.duration_ms) || 0,
      userAudioUrl: userAudio.url,
      transcript: parsed.transcript,
      assistantReply: parsed.reply_text,
      provider: parsed.provider,
      endIntent: false,
      assistantAudioUrl,
      assistantAudioDurationMs: Number(parsed.assistant_duration_ms) || 0,
    }
    logRouteEvent('log', 'save-turn:upload:user-audio', {
      sessionId: parsed.sessionId,
      path: audioPath,
      mime,
      bytes: buffer.byteLength,
    })
    const manifest = await putBlobFromBuffer(
      manifestPath,
      Buffer.from(JSON.stringify(manifestBody, null, 2), 'utf8'),
      'application/json',
      { access: 'public' }
    )

    logRouteEvent('log', 'save-turn:upload:manifest', {
      sessionId: parsed.sessionId,
      path: manifestPath,
      url: manifest.url || null,
    })

    const responsePayload = { ok: true, userAudioUrl: userAudio.url, manifestUrl: manifest.url }
    logRouteEvent('log', 'save-turn:success', {
      sessionId: parsed.sessionId,
      turn: turnNumber,
      userAudioUrl: userAudio.url || null,
      manifestUrl: manifest.url || null,
      assistantAudioUrl,
    })
    return NextResponse.json(responsePayload)
  } catch (error) {
    logRouteEvent('error', 'save-turn:failed', {
      url: req.url,
      error: serializeError(error),
    })
    return jsonErrorResponse(error, 'Failed to save turn', 400, {
      reason: 'save_turn_failed',
    })
  }
}
