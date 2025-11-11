import { DEFAULT_NOTIFY_EMAIL_GLOBAL_KEY, isPlaceholderEmail, maskEmail } from './default-notify-email.shared'

type DiagnosticLevel = 'log' | 'error'

type DiagnosticPayload = Record<string, unknown>

function timestamp() {
  return new Date().toISOString()
}

function clientSummary() {
  if (typeof window === 'undefined') {
    return { origin: '__no_window__', pathname: '__no_window__' }
  }
  return { origin: window.location.origin, pathname: window.location.pathname }
}

function log(level: DiagnosticLevel, step: string, payload: DiagnosticPayload = {}) {
  const entry = { ...payload, clientSummary: clientSummary() }
  const message = `[diagnostic] ${timestamp()} ${step} ${JSON.stringify(entry)}`
  if (level === 'error') {
    console.error(message)
  } else {
    console.log(message)
  }
}

const hypotheses = [
  'The server bootstrap script may not have executed before client modules loaded.',
  'NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL might be missing from the build environment.',
  'The configured email could still be using a placeholder fallback.',
]

function assertEmail(value: string | undefined, source: string): string {
  if (!value) {
    log('error', 'default-email:client:missing', { source, hypotheses })
    throw new Error('NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL is required for client defaults but was not provided.')
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    log('error', 'default-email:client:missing', { source, hypotheses })
    throw new Error('NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL is required for client defaults but was not provided.')
  }
  if (isPlaceholderEmail(trimmed)) {
    log('error', 'default-email:client:fallback', { source, emailPreview: maskEmail(trimmed) })
    throw new Error('NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL is using a fallback placeholder; configure a production address.')
  }
  log('log', 'default-email:client:resolved', { source, emailPreview: maskEmail(trimmed) })
  return trimmed
}

export function readDefaultNotifyEmailClient(): string {
  if (typeof window === 'undefined') {
    log('log', 'default-email:client:using-server-env', { hypotheses })
    return assertEmail(process.env.DEFAULT_NOTIFY_EMAIL, 'server-env')
  }

  const globalValue = Reflect.get(
    window,
    DEFAULT_NOTIFY_EMAIL_GLOBAL_KEY,
  ) as unknown
  if (typeof globalValue === 'string' && globalValue.trim().length) {
    return assertEmail(globalValue, 'bootstrap-global')
  }

  const nextPublic = process.env.NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL
  if (typeof nextPublic === 'string') {
    return assertEmail(nextPublic, 'next-public-env')
  }

  return assertEmail(undefined, 'unavailable')
}
