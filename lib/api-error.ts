import { NextResponse } from 'next/server'

import { logBlobDiagnostic } from '@/utils/blob-env'

type MaybeError = {
  status?: number
  statusCode?: number
  message?: string
  stack?: string
  code?: string
  blobDetails?: unknown
  [key: string]: unknown
}

function extractStatus(error: MaybeError, fallback?: number): number {
  const candidates = [
    fallback,
    error?.status,
    error?.statusCode,
    typeof error?.response === 'object' && error?.response ? (error.response as MaybeError).status : undefined,
    typeof error?.response === 'object' && error?.response ? (error.response as MaybeError).statusCode : undefined,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 400) {
      return candidate
    }
  }
  return 500
}

function extractMessage(error: MaybeError, fallback: string): string {
  if (error?.message && typeof error.message === 'string' && error.message.trim().length) {
    return error.message
  }
  if (typeof error?.originalMessage === 'string' && error.originalMessage.trim().length) {
    return error.originalMessage
  }
  return fallback
}

export function jsonErrorResponse(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus?: number,
  extras?: Record<string, unknown>,
) {
  const err = (error ?? {}) as MaybeError
  const status = extractStatus(err, fallbackStatus)
  const message = extractMessage(err, fallbackMessage)
  const payload: Record<string, unknown> = {
    ok: false,
    message,
  }
  if (typeof err.stack === 'string' && err.stack.trim().length) {
    payload.stack = err.stack
  }
  if (err.blobDetails != null) {
    payload.blobDetails = err.blobDetails
  }
  if (typeof err.code === 'string' && err.code.length) {
    payload.code = err.code
  }
  const responsePayload = { ...payload, ...(extras ?? {}) }

  logBlobDiagnostic('error', 'json-error-response', {
    note: 'Responding with structured error payload',
    status,
    message,
    extras: extras && Object.keys(extras).length ? extras : undefined,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : err && Object.keys(err).length
        ? err
        : { message: fallbackMessage },
  })

  return NextResponse.json(responsePayload, { status })
}
