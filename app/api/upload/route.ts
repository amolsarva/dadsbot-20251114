import { NextRequest, NextResponse } from 'next/server'

const ROUTE_NAME = 'app/api/upload'

type LogLevel = 'log' | 'error'

type LogDetails = Record<string, unknown>

function timestamp(): string {
  return new Date().toISOString()
}

function envSummary() {
  return {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    awsRegion: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null,
    nextRuntime: process.env.NEXT_RUNTIME ?? null,
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause && error.cause instanceof Error
          ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack }
          : error.cause ?? null,
    }
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

function log(level: LogLevel, step: string, details?: LogDetails) {
  const entry = {
    route: ROUTE_NAME,
    step,
    env: envSummary(),
    ...(details ?? {}),
  }
  if (level === 'error') {
    console.error(`[diagnostic] ${timestamp()} ${ROUTE_NAME}:${step}`, entry)
  } else {
    console.log(`[diagnostic] ${timestamp()} ${ROUTE_NAME}:${step}`, entry)
  }
}

const HYPOTHESES = [
  'Upload request body is invalid JSON or missing required fields.',
  'Blob storage credentials are misconfigured or unavailable.',
  'The upload handler has not been configured for this deployment.',
]

export async function POST(request: NextRequest) {
  log('log', 'hypotheses', { hypotheses: HYPOTHESES })
  log('log', 'request:received', {
    method: request.method,
    url: request.url,
    headerKeys: Array.from(request.headers.keys()),
  })

  try {
    const body = await request.json()
    const bodyKeys = body && typeof body === 'object' ? Object.keys(body) : null
    log('log', 'request:body-parsed', { bodyKeys })

    const error = new Error(
      'Upload endpoint is not configured. Set up the handler logic and required environment variables.',
    )
    throw error
  } catch (error) {
    const serialized = serializeError(error)
    log('error', 'request:failed', { error: serialized })

    const message =
      typeof serialized === 'object' && serialized && 'message' in serialized && serialized.message
        ? String(serialized.message)
        : 'Unknown upload failure'

    return new NextResponse(
      JSON.stringify({ ok: false, message, hypotheses: HYPOTHESES }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
