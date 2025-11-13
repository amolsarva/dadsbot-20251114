import { NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment, primeStorageContextFromHeaders } from '@/lib/blob'
import { dbHealth } from '@/lib/data'
import { areSummaryEmailsEnabled } from '@/lib/email'
import { resolveDefaultNotifyEmailServer } from '@/lib/default-notify-email.server'
import { getSecret } from '@/lib/secrets.server'

type DiagnosticLevel = 'log' | 'error'

type DiagnosticPayload = Record<string, unknown>

function timestamp() {
  return new Date().toISOString()
}

function envSummary() {
  const storageMode = getSecret('STORAGE_MODE') ?? null
  const supabaseUrl = getSecret('SUPABASE_URL')
  const supabaseBucket = getSecret('SUPABASE_STORAGE_BUCKET')
  return {
    deployId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.DEPLOY_ID ?? null,
    storageMode,
    supabaseUrl: supabaseUrl ? `${supabaseUrl.slice(0, 8)}… (${supabaseUrl.length} chars)` : null,
    supabaseBucket: supabaseBucket ?? null,
    hasOpenAI: Boolean(getSecret('OPENAI_API_KEY')),
    hasResend: Boolean(getSecret('RESEND_API_KEY')),
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  }
}

function logDiagnostic(level: DiagnosticLevel, step: string, payload: DiagnosticPayload = {}) {
  const entry = { ...payload, envSummary: envSummary() }
  const message = `[diagnostic] ${timestamp()} health:${step}`
  if (level === 'error') {
    console.error(message, entry)
  } else {
    console.log(message, entry)
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch {
      return { ...error }
    }
  }
  return { message: typeof error === 'string' ? error : 'Unknown error', value: error }
}

function formatStorageErrorDetail(error: unknown) {
  if (!error) {
    return 'Storage environment missing required configuration.'
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export async function GET(request: Request) {
  logDiagnostic('log', 'request:start', {
    method: request.method,
    url: request.url,
  })

  logDiagnostic('log', 'deploy-env:probe', {
    deployId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.DEPLOY_ID ?? null,
  })

  try {
    const contextPrimed = primeStorageContextFromHeaders(request.headers)
    logDiagnostic('log', 'context:prime:complete', {
      contextPrimed,
    })

    const blob = await blobHealth()
    logDiagnostic('log', 'blob-health:complete', { blob })
    if (!blob.ok) {
      logDiagnostic('error', 'blob-health:failed', { blob })
      const reasonDetail = blob.reason ? `Reason: ${blob.reason}.` : 'Reason: not provided.'
      throw new Error(
        `Blob storage health check failed in ${blob.mode} mode. ${reasonDetail} Verify STORAGE_MODE and required Supabase secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET) or switch to memory mode for local testing.`,
      )
    }

    const db = await dbHealth()
    logDiagnostic('log', 'db-health:complete', { db })

    const storageEnv = getBlobEnvironment()
    logDiagnostic('log', 'storage-env:resolved', {
      provider: storageEnv.provider,
      configured: storageEnv.configured,
      bucket: (storageEnv as any).bucket ?? null,
    })
    if (!storageEnv.configured) {
      logDiagnostic('error', 'storage-env:unconfigured', {
        provider: storageEnv.provider,
        diagnostics: storageEnv.diagnostics,
        bucket: (storageEnv as any).bucket ?? null,
        error: storageEnv.error ? serializeError(storageEnv.error) : null,
      })
      const detail = formatStorageErrorDetail(storageEnv.error)
      throw new Error(
        `Blob storage is not configured. Set STORAGE_MODE to "memory" for local testing or provide Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET) and redeploy. Details: ${detail}`,
      )
    }

    const defaultEmail = resolveDefaultNotifyEmailServer()

    const env = {
      hasOpenAI: Boolean(getSecret('OPENAI_API_KEY')),
      hasBlobStore: storageEnv.configured,
      storageProvider: storageEnv.provider,
      storageBucket: (storageEnv as any).bucket ?? null,
      storageStore: (storageEnv as any).bucket ?? null,
      storageError: storageEnv.error ?? null,
      hasResend: Boolean(getSecret('RESEND_API_KEY')),
      emailsEnabled: areSummaryEmailsEnabled(),
      defaultEmail,
      blobDiagnostics: storageEnv.diagnostics,
    }

    logDiagnostic('log', 'response:success', { blob, db, env })

    return NextResponse.json({ ok: true, env, blob, db })
  } catch (error) {
    const serialized = serializeError(error)
    logDiagnostic('error', 'response:error', {
      error: serialized,
    })

    return NextResponse.json(
      {
        ok: false,
        message: serialized.message ?? 'Health check failed',
        error: serialized,
      },
      { status: 500 },
    )
  }
}
