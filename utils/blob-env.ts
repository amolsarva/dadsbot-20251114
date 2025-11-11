import { getSecret, getSecretsSnapshot, requireSecret, requireSecretEnum } from '@/lib/secrets.server'

type DiagnosticPayload = Record<string, unknown> | undefined

type LogLevel = 'log' | 'error'

type StorageMode = 'supabase' | 'memory'

const STORAGE_MODE_OPTIONS = ['supabase', 'memory'] as const

function timestamp() {
  return new Date().toISOString()
}

function storageEnvSummary() {
  const secrets = getSecretsSnapshot()
  const modeRaw = getSecret('STORAGE_MODE') ?? null
  const supabaseUrl = getSecret('SUPABASE_URL')
  const bucket = getSecret('SUPABASE_STORAGE_BUCKET')
  const serviceRole = getSecret('SUPABASE_SERVICE_ROLE_KEY')
  return {
    mode: modeRaw,
    supabaseUrl: supabaseUrl ? '[set]' : null,
    supabaseBucket: bucket ?? null,
    supabaseServiceRoleKey: serviceRole ? `${serviceRole.length} chars` : null,
    secretsLoadedAt: secrets.loadedAt,
    tmpKeysPath: secrets.path,
    netlify: process.env.NETLIFY ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  }
}

export function logBlobDiagnostic(level: LogLevel, event: string, payload?: DiagnosticPayload) {
  const message = `[diagnostic] ${timestamp()} storage:${event}`
  const base = payload && typeof payload === 'object' ? { ...payload } : {}
  const entry = { ...base, env: storageEnvSummary() }
  if (level === 'error') {
    console.error(message, entry)
  } else {
    console.log(message, entry)
  }
}

export function describeBlobEnvSnapshot() {
  return storageEnvSummary()
}

export function getStorageMode(): StorageMode {
  const mode = requireSecretEnum('STORAGE_MODE', STORAGE_MODE_OPTIONS)
  return mode
}

export function assertBlobEnv() {
  const mode = getStorageMode()
  if (mode === 'supabase') {
    const url = requireSecret('SUPABASE_URL')
    const key = requireSecret('SUPABASE_SERVICE_ROLE_KEY')
    const bucket = requireSecret('SUPABASE_STORAGE_BUCKET')
    logBlobDiagnostic('log', 'supabase-env-ok', {
      urlSet: Boolean(url),
      serviceRoleLength: key.length,
      bucket,
    })
  } else {
    logBlobDiagnostic('log', 'memory-env-selected', {})
  }
}

