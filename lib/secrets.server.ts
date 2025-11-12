export type SecretAccessLevel = 'optional' | 'required'

type SecretsCache = {
  loadedAt: string
  source: string
  values: Map<string, string>
  raw: Record<string, string>
}

let cache: SecretsCache | null = null

function timestamp() {
  return new Date().toISOString()
}

function envSummary() {
  return {
    platform: process.env.VERCEL ? 'vercel' : 'custom',
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    totalLoaded: cache?.values.size ?? 0,
    source: cache?.source ?? 'process.env',
  }
}

type LogLevel = 'log' | 'error'

type LogPayload = Record<string, unknown>

function logSecrets(level: LogLevel, step: string, payload: LogPayload = {}) {
  const entry = { ...payload, envSummary: envSummary() }
  const message = `[diagnostic] ${timestamp()} secrets:${step}`
  if (level === 'error') {
    console.error(message, entry)
  } else {
    console.log(message, entry)
  }
}

function normalizeKey(input: string) {
  return input.trim().replace(/\s+/g, '_').toUpperCase()
}

function loadSecrets(): SecretsCache {
  logSecrets('log', 'load:start', { totalEnvKeys: Object.keys(process.env).length })
  const values = new Map<string, string>()
  const raw: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') {
      continue
    }
    const normalized = normalizeKey(key)
    const trimmedValue = value.trim()
    if (!trimmedValue.length) {
      continue
    }
    values.set(normalized, trimmedValue)
    raw[normalized] = trimmedValue
  }
  const loaded: SecretsCache = {
    loadedAt: timestamp(),
    source: 'process.env',
    values,
    raw,
  }
  cache = loaded
  logSecrets('log', 'load:complete', { keys: Array.from(values.keys()) })
  return loaded
}

function ensureCache(): SecretsCache {
  if (cache) {
    return cache
  }
  return loadSecrets()
}

function lookupSecret(key: string) {
  const normalized = normalizeKey(key)
  const state = ensureCache()
  if (state.values.has(normalized)) {
    const value = state.values.get(normalized) as string
    logSecrets('log', 'lookup:hit', { key: normalized, length: value.length })
    return value
  }
  logSecrets('log', 'lookup:miss', { key: normalized })
  return undefined
}

export function getSecret(key: string): string | undefined {
  return lookupSecret(key)
}

export function requireSecret(key: string): string {
  const value = lookupSecret(key)
  if (!value) {
    logSecrets('error', 'lookup:missing', { key })
    throw new Error(`Missing required secret ${key}. Provide it via environment variables before deploying.`)
  }
  return value
}

export function getSecretsSnapshot() {
  const state = ensureCache()
  const summary: Record<string, string | number> = {}
  for (const [key, value] of state.values.entries()) {
    summary[key] = value.length
  }
  return {
    loadedAt: state.loadedAt,
    source: state.source,
    keys: Array.from(state.values.keys()),
    summary,
  }
}

export function refreshSecretsCache() {
  cache = null
  logSecrets('log', 'cache:cleared')
}

export function requireSecretEnum<T extends readonly string[]>(key: string, allowed: T): T[number] {
  const value = requireSecret(key)
  const normalized = value.toLowerCase()
  const match = allowed.find((option) => option.toLowerCase() === normalized)
  if (!match) {
    logSecrets('error', 'lookup:invalid-enum', { key, value, allowed })
    throw new Error(`Invalid value for ${key}. Expected one of ${allowed.join(', ')}, received ${value}.`)
  }
  logSecrets('log', 'lookup:enum', { key, value: match })
  return match as T[number]
}

export function getOptionalSecretEnum<T extends readonly string[]>(
  key: string,
  allowed: T,
): T[number] | undefined {
  const value = getSecret(key)
  if (!value) return undefined
  const normalized = value.toLowerCase()
  const match = allowed.find((option) => option.toLowerCase() === normalized)
  if (!match) {
    logSecrets('error', 'lookup:invalid-enum', { key, value, allowed })
    throw new Error(`Invalid value for ${key}. Expected one of ${allowed.join(', ')}, received ${value}.`)
  }
  logSecrets('log', 'lookup:enum', { key, value: match })
  return match as T[number]
}

