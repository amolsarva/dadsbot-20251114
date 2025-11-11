const PLACEHOLDER_EMAILS = ['a@sarva.co', 'noreply@example.com'] as const

export const DEFAULT_NOTIFY_EMAIL_GLOBAL_KEY = '__dads_default_notify_email__'

export function isPlaceholderEmail(value: string | undefined | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return PLACEHOLDER_EMAILS.some((candidate) => candidate.toLowerCase() === normalized)
}

export function maskEmail(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const [localPart, domain] = trimmed.split('@')
  if (!domain || localPart.length <= 2) {
    return `${trimmed.slice(0, 2)}…`
  }
  const maskedLocal = localPart.length <= 4 ? `${localPart.slice(0, 1)}…${localPart.slice(-1)}` : `${localPart.slice(0, 2)}…${localPart.slice(-2)}`
  const maskedDomain = domain.length <= 4 ? `${domain.slice(0, 1)}…${domain.slice(-1)}` : `${domain.slice(0, 2)}…${domain.slice(-2)}`
  return `${maskedLocal}@${maskedDomain}`
}
