export const DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash-lite'

const LEGACY_PREFIX = /^models\//i
const LEGACY_MODEL_PATTERNS = [
  /^gemini-1[._-]/i,
  /^gemini-1$/i,
  /^gemini-pro/i,
  /^text-bison/i,
  /^chat-bison/i,
]

function normalizeModelCandidate(candidate: string | null | undefined): string | null {
  if (!candidate || typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!trimmed) return null
  const withoutPrefix = trimmed.replace(LEGACY_PREFIX, '')
  const lower = withoutPrefix.toLowerCase()
  if (!withoutPrefix) return null

  if (lower === 'gemini-2.5-flash') {
    return 'gemini-2.5-flash-lite'
  }

  if (LEGACY_MODEL_PATTERNS.some((pattern) => pattern.test(lower))) {
    return DEFAULT_GOOGLE_MODEL
  }

  return withoutPrefix
}

export function resolveGoogleModel(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const normalized = normalizeModelCandidate(candidate)
    if (normalized) {
      return normalized
    }
  }
  const timestamp = new Date().toISOString()
  const hypotheses = [
    'GOOGLE_MODEL may be unset for the current deployment.',
    'GOOGLE_DIAGNOSTICS_MODEL may not be defined for diagnostics flows.',
    'The provided model values may be blank or whitespace after trimming.',
  ]
  const payload = {
    hypotheses,
    candidates: candidates.map((candidate) => (typeof candidate === 'string' ? candidate : null)),
  }
  console.error(`[diagnostic] ${timestamp} google:resolve-model:missing ${JSON.stringify(payload)}`)
  throw new Error(
    'No valid Google model has been configured. Set GOOGLE_MODEL (or GOOGLE_DIAGNOSTICS_MODEL for diagnostics) to a supported Gemini model name.',
  )
}
