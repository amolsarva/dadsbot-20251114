import { NextResponse } from 'next/server'
import { appendTurn, createSession, finalizeSession } from '@/lib/data'
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

function wrapStage<T>(stage: Stage, task: () => Promise<T>): Promise<T> {
  return task().catch(err => {
    const error = err instanceof Error ? err : new Error(String(err))
    ;(error as any).diagnosticStage = stage
    throw error
  })
}

export async function POST(request: Request) {
  try {
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
      finalizeSession(session.id, { clientDurationMs: 1500 })
    )

    return NextResponse.json({ ok: true, sessionId: session.id, result, foxes: listFoxes() })
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
        : 'e2e_failed'
    return jsonErrorResponse(error, fallbackMessage, 500, {
      stage,
      details: blobDetails,
      cause: causeMessage,
      foxes: listFoxes(),
    })
  }
}

