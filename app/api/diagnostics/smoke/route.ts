import { NextResponse } from 'next/server'
import { createSession, appendTurn, finalizeSession, deleteSession } from '@/lib/data'
import { primeStorageContextFromHeaders } from '@/lib/blob'
import { listFoxes } from '@/lib/foxes'
import { jsonErrorResponse } from '@/lib/api-error'
import { resolveDefaultNotifyEmailServer } from '@/lib/default-notify-email.server'

export const runtime = 'nodejs'

type Stage =
  | 'create_session'
  | 'append_user_turn'
  | 'append_assistant_turn'
  | 'finalize_session'
  | 'cleanup_session'

function diagnosticTimestamp() {
  return new Date().toISOString()
}

function diagnosticEnvSummary() {
  return {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  }
}

function logDiagnostic(step: string, payload: Record<string, unknown> = {}) {
  console.log(`[diagnostic] ${diagnosticTimestamp()} diagnostics:smoke:${step}`, {
    ...payload,
    envSummary: diagnosticEnvSummary(),
  })
}

function logDiagnosticError(step: string, error: unknown, payload: Record<string, unknown> = {}) {
  const serializedError =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
  console.error(`[diagnostic] ${diagnosticTimestamp()} diagnostics:smoke:${step}:error`, {
    ...payload,
    envSummary: diagnosticEnvSummary(),
    error: serializedError,
  })
}

function wrapStage<T>(stage: Stage, task: () => Promise<T>): Promise<T> {
  logDiagnostic(`${stage}:start`, { stage })
  return task()
    .then(result => {
      logDiagnostic(`${stage}:success`, { stage })
      return result
    })
    .catch(err => {
      logDiagnosticError(stage, err, { stage })
      const error = err instanceof Error ? err : new Error(String(err))
      ;(error as any).diagnosticStage = stage
      throw error
    })
}

export async function POST(request: Request) {
  try {
    logDiagnostic('request:received', {
      hasHeaders: !!request.headers,
    })
    primeStorageContextFromHeaders(request.headers)
    const session = await wrapStage('create_session', () =>
      createSession({ email_to: resolveDefaultNotifyEmailServer() })
    )

    await wrapStage('append_user_turn', () =>
      appendTurn(session.id, { role: 'user', text: 'Hello world' } as any)
    )

    await wrapStage('append_assistant_turn', () =>
      appendTurn(session.id, { role: 'assistant', text: 'Tell me more about that.' } as any)
    )

    const result = await wrapStage('finalize_session', () =>
      finalizeSession(session.id, { clientDurationMs: 5000 })
    )

    await wrapStage('cleanup_session', async () => {
      const cleanup = await deleteSession(session.id)
      if (!cleanup.ok) {
        throw new Error(`cleanup_failed:${cleanup.reason ?? 'unknown_reason'}`)
      }
      logDiagnostic('cleanup_session:deleted', {
        sessionId: session.id,
        deleted: cleanup.deleted,
        reason: cleanup.reason ?? null,
      })
    })

    if ('skipped' in result && result.skipped) {
      return NextResponse.json({ ok: true, sessionId: session.id, skipped: true, foxes: listFoxes() })
    }

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      artifacts: result.session.artifacts,
      emailed: result.emailed,
      foxes: listFoxes(),
    })
  } catch (error) {
    const blobDetails =
      error && typeof error === 'object'
        ? (error as any).blobDetails ||
          ((error as any).cause && typeof (error as any).cause === 'object'
            ? (error as any).cause.blobDetails
            : undefined)
        : undefined
    const causeMessage =
      error && typeof error === 'object' && (error as any).cause && typeof (error as any).cause === 'object'
        ? (error as any).cause.message
        : undefined
    const stage =
      error && typeof error === 'object' && typeof (error as any).diagnosticStage === 'string'
        ? (error as any).diagnosticStage
        : 'unknown'
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.trim().length
        ? (error as any).message
        : 'smoke_failed'
    logDiagnosticError('request:failed', error, { stage })
    return jsonErrorResponse(error, fallbackMessage, 500, {
      stage,
      details: blobDetails,
      cause: causeMessage,
      foxes: listFoxes(),
    })
  }
}
