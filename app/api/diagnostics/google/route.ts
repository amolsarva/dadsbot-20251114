import { NextResponse } from 'next/server'
import { jsonErrorResponse } from '@/lib/api-error'
import { getSecret } from '@/lib/secrets.server'
import { createDiagnosticLogger, serializeError } from '@/lib/logging'
import { resolveGoogleModel } from '@/lib/google'

export const runtime = 'nodejs'

const hypotheses = [
  'GOOGLE_API_KEY may be unset in the diagnostics environment.',
  'GOOGLE_DIAGNOSTICS_MODEL or GOOGLE_MODEL might be blank.',
  'The Google API response could contain errors or empty candidates.',
]

const log = createDiagnosticLogger('diagnostics:google')

function secretsSummary() {
  return {
    googleApiKey: getSecret('GOOGLE_API_KEY') ? '[set]' : null,
    diagnosticsModel: getSecret('GOOGLE_DIAGNOSTICS_MODEL') ?? null,
    fallbackModel: getSecret('GOOGLE_MODEL') ?? null,
  }
}

function logStep(level: 'log' | 'error', step: string, payload: Record<string, unknown> = {}) {
  log(level, step, {
    ...payload,
    secrets: secretsSummary(),
  })
}

function extractReplyText(payload: any): string {
  if (!payload) return ''
  try {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
      const text = parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .filter((value: string) => Boolean(value && value.trim().length))
        .join('\n')
      if (text.trim().length) {
        return text.trim()
      }
    }
  } catch {}
  return ''
}

export async function GET() {
  logStep('log', 'request:start', { hypotheses })

  const googleApiKey = getSecret('GOOGLE_API_KEY')?.trim() ?? ''
  if (!googleApiKey) {
    const message = 'GOOGLE_API_KEY is required for diagnostics.'
    logStep('error', 'request:missing-api-key', { message })
    return NextResponse.json({ ok: false, error: 'missing_google_api_key', message }, { status: 500 })
  }

  let model: string
  try {
    model = resolveGoogleModel(getSecret('GOOGLE_DIAGNOSTICS_MODEL'), getSecret('GOOGLE_MODEL'))
    logStep('log', 'model:resolved', { model })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to resolve Google diagnostics model. Configure GOOGLE_DIAGNOSTICS_MODEL or GOOGLE_MODEL.'
    logStep('error', 'model:resolution-failed', { message, error: serializeError(error) })
    return NextResponse.json({ ok: false, error: 'missing_google_model', message }, { status: 500 })
  }

  const prompt = 'Reply with a short confirmation that the Google diagnostics check succeeded.'

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        cache: 'no-store',
      },
    )

    const json = await response.json().catch(() => ({}))
    const reply = extractReplyText(json)
    const providerStatus = response.status
    const providerErrorMessage =
      typeof json?.error?.message === 'string'
        ? json.error.message
        : typeof json?.error === 'string'
        ? json.error
        : !response.ok
        ? response.statusText || 'Provider request failed'
        : null
    const providerResponseSnippet = reply ? reply.slice(0, 400) : JSON.stringify(json?.error || json || {})

    if (!response.ok) {
      const message =
        typeof json?.error?.message === 'string'
          ? json.error.message
          : typeof json?.error === 'string'
          ? json.error
          : response.statusText || 'Request failed'

      logStep('error', 'request:provider-error', {
        status: response.status,
        message,
        providerResponseSnippet,
      })
      return NextResponse.json(
        {
          ok: false,
          status: response.status,
          message,
          model: { name: model },
        },
        { status: response.status >= 400 ? response.status : 502 },
      )
    }

    logStep('log', 'request:success', {
      status: providerStatus,
      providerError: providerErrorMessage,
    })
    return NextResponse.json({
      ok: true,
      status: providerStatus,
      model: { name: model },
      reply,
    })
  } catch (error) {
    logStep('error', 'request:exception', { error: serializeError(error) })
    return jsonErrorResponse(error, 'Google diagnostics failed')
  }
}
