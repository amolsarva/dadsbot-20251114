import fs from 'fs'
import path from 'path'

export type SecretAccessLevel = 'optional' | 'required'

type SecretsCache = {
  loadedAt: string
  path: string
  values: Map<string, string>
  raw: Record<string, string>
}

let cache: SecretsCache | null = null

function timestamp() {
  return new Date().toISOString()
}

function envSummary() {
  return {
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    tmpKeysPath: cache?.path ?? resolveSecretsPath(),
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

function resolveSecretsPath() {
  const explicit = process.env.TMP_KEYS_PATH
  if (explicit && explicit.trim()) {
    return path.resolve(explicit.trim())
  }
  return path.resolve(process.cwd(), 'tmpkeys.txt')
}

type ParseResult = {
  values: Map<string, string>
  raw: Record<string, string>
}

function normalizeKey(input: string) {
  return input.trim().replace(/\s+/g, '_').toUpperCase()
}

function parseSecrets(contents: string): ParseResult {
  const values = new Map<string, string>()
  const raw: Record<string, string> = {}
  const lines = contents.split(/\r?\n/)
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }
    const match = trimmed.match(/([^:=\s]+)\s*[:=]?\s*(.+)?$/)
    if (!match) {
      logSecrets('error', 'parse:invalid-line', { line: trimmed, index })
      throw new Error(`Invalid entry in tmpkeys.txt on line ${index + 1}: "${trimmed}"`)
    }
    const key = normalizeKey(match[1])
    const value = (match[2] ?? '').trim()
    if (!key || !value) {
      logSecrets('error', 'parse:missing-value', { key, index })
      throw new Error(`Missing value for ${key} in tmpkeys.txt on line ${index + 1}`)
    }
    values.set(key, value)
    raw[key] = value
  })
  return { values, raw }
}

function loadSecrets(): SecretsCache {
  const resolvedPath = resolveSecretsPath()
  logSecrets('log', 'load:start', { path: resolvedPath })
  let contents: string
  try {
    contents = fs.readFileSync(resolvedPath, 'utf8')
  } catch (error) {
    logSecrets('error', 'load:failed', {
      path: resolvedPath,
      error: serializeError(error),
    })
    throw new Error(
      `Unable to read tmpkeys.txt at ${resolvedPath}. Ensure the file exists with KEY=value entries before starting the server.`,
    )
  }
  const { values, raw } = parseSecrets(contents)
  const loaded: SecretsCache = {
    loadedAt: timestamp(),
    path: resolvedPath,
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

type SerializeError = ReturnType<typeof serializeError>

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause ?? null,
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
    throw new Error(`Missing required secret ${key}. Add it to tmpkeys.txt before deploying.`)
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
    path: state.path,
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

