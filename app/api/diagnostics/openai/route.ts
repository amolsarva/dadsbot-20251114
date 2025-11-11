import { NextResponse } from 'next/server'
import OpenAI from 'openai'

import { jsonErrorResponse } from '@/lib/api-error'
import { getSecret, requireSecret } from '@/lib/secrets.server'
import { createDiagnosticLogger, serializeError } from '@/lib/logging'

export const runtime = 'nodejs'

const hypotheses = [
  'OPENAI_API_KEY may be unset for diagnostics.',
  'OPENAI_DIAGNOSTICS_MODEL could be missing or blank.',
  'The OpenAI API might return an error payload or empty choices.',
]

const log = createDiagnosticLogger('diagnostics:openai')

function secretsSummary() {
  return {
    openaiApiKey: getSecret('OPENAI_API_KEY') ? '[set]' : null,
    diagnosticsModel: getSecret('OPENAI_DIAGNOSTICS_MODEL') ?? null,
  }
}

function logStep(level: 'log' | 'error', step: string, payload: Record<string, unknown> = {}) {
  log(level, step, {
    ...payload,
    secrets: secretsSummary(),
  })
}

function extractErrorMessage(error: any): string {
  if (!error) return 'openai_diagnostics_failed'
  if (typeof error?.error?.message === 'string') return error.error.message
  if (typeof error?.response?.data?.error?.message === 'string') return error.response.data.error.message
  if (typeof error?.response?.data?.error === 'string') return error.response.data.error
  if (typeof error?.message === 'string') return error.message
  return 'openai_diagnostics_failed'
}

function extractStatus(error: any): number {
  if (!error) return 500
  if (typeof error?.status === 'number') return error.status
  if (typeof error?.response?.status === 'number') return error.response.status
  return 500
}

export async function GET() {
  logStep('log', 'request:start', { hypotheses })

  const apiKey = requireSecret('OPENAI_API_KEY').trim()
  const diagnosticsModel = getSecret('OPENAI_DIAGNOSTICS_MODEL')?.trim() ?? ''
  if (!diagnosticsModel) {
    const message = 'OPENAI_DIAGNOSTICS_MODEL must be configured for diagnostics checks.'
    logStep('error', 'request:missing-model', { message })
    return NextResponse.json({ ok: false, error: 'missing_openai_model', message }, { status: 500 })
  }

  const client = new OpenAI({ apiKey })
  const model = diagnosticsModel

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are verifying connectivity for diagnostics.' },
        { role: 'user', content: 'Reply with a brief confirmation that OpenAI connectivity works.' },
      ],
      max_tokens: 60,
    })

    const reply = completion.choices?.[0]?.message?.content?.trim() || ''

    logStep('log', 'request:success', {
      model,
      replyLength: reply.length,
    })
    return NextResponse.json({
      ok: true,
      status: 200,
      model: { id: completion.model || model },
      reply,
    })
  } catch (error) {
    const status = extractStatus(error)
    const message = extractErrorMessage(error)
    logStep('error', 'request:exception', {
      status,
      message,
      error: serializeError(error),
    })
    return jsonErrorResponse(error, message, status >= 400 ? status : 502, {
      status,
      error: message,
    })
  }
}
