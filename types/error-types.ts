export interface BlobErrorReport {
  message?: string
  reason?: string
  originalMessage?: string
  status?: number
  [key: string]: unknown
}

export interface UploadResultPayload {
  ok?: boolean
  url?: string | null
  downloadUrl?: string | null
  status?: number
  message?: string
  reason?: string
  [key: string]: unknown
}

export type ErrorPayload = BlobErrorReport | UploadResultPayload | null | undefined

export function resolveErrorMessage(payload: ErrorPayload, fallback: string): string {
  const messageCandidates: unknown[] = []

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    messageCandidates.push(record.message, record.reason, record.originalMessage)
  }

  const resolved = messageCandidates.find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )

  return resolved ? resolved.trim() : fallback
}
