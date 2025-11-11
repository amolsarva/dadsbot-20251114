import { getStore, type GetStoreOptions, type Store } from '@netlify/blobs'
import { resolveDeploymentMetadata, type DeploymentMetadata } from '@/lib/deployment-metadata.server'

const REQUIRED_BASE = ['NETLIFY_BLOBS_SITE_ID', 'NETLIFY_BLOBS_STORE'] as const
const OPTIONAL_KEYS = ['NETLIFY_BLOBS_API_URL', 'NETLIFY_BLOBS_TOKEN'] as const
const SNAPSHOT_KEYS = [...REQUIRED_BASE, ...OPTIONAL_KEYS] as const

type RequiredKey = (typeof REQUIRED_BASE)[number]
type SnapshotKey = (typeof SNAPSHOT_KEYS)[number]

type BlobEnvSnapshot = Record<SnapshotKey, string | undefined>

type BlobEnvAssertionOptions = {
  requireToken?: boolean
  requireApiUrl?: boolean
  snapshot?: BlobEnvSnapshot
  note?: string
}

type RequirementEnforcement = 'always' | 'requireToken' | 'requireApiUrl'

type RequirementSeverity = 'ok' | 'warn' | 'info' | 'error'

type RequirementDefinition = {
  key: SnapshotKey
  label: string
  description: string
  baseRequired: boolean
  enforceOption?: Extract<RequirementEnforcement, 'requireToken' | 'requireApiUrl'>
  warnWhenMissing?: boolean
}

type RequirementCheck = {
  key: SnapshotKey
  label: string
  description: string
  required: boolean
  present: boolean
  severity: RequirementSeverity
  enforcedBy: RequirementEnforcement | null
  valuePreview: string | null
}

const REQUIREMENTS: RequirementDefinition[] = [
  {
    key: 'NETLIFY_BLOBS_SITE_ID',
    label: 'Netlify site identifier',
    description:
      'Set NETLIFY_BLOBS_SITE_ID to the Netlify site UUID. Using a slug requires a token to resolve automatically.',
    baseRequired: true,
  },
  {
    key: 'NETLIFY_BLOBS_STORE',
    label: 'Netlify blob store name',
    description: 'Set NETLIFY_BLOBS_STORE to the exact blob store name created in Netlify.',
    baseRequired: true,
  },
  {
    key: 'NETLIFY_BLOBS_TOKEN',
    label: 'Netlify API token',
    description:
      'Set NETLIFY_BLOBS_TOKEN so authorized API calls can run. Required when resolving slugs or writing blobs.',
    baseRequired: false,
    enforceOption: 'requireToken',
    warnWhenMissing: true,
  },
  {
    key: 'NETLIFY_BLOBS_API_URL',
    label: 'Netlify blobs API URL',
    description: 'Set NETLIFY_BLOBS_API_URL when overriding the default Netlify blobs endpoint.',
    baseRequired: false,
    enforceOption: 'requireApiUrl',
    warnWhenMissing: true,
  },
]

function previewRequirementValue(key: SnapshotKey, value: string | undefined): string | null {
  if (!hasValue(value)) return null
  switch (key) {
    case 'NETLIFY_BLOBS_SITE_ID':
      return maskValue(value) || null
    case 'NETLIFY_BLOBS_TOKEN':
      return `${value.length} chars`
    default:
      return value
  }
}

function evaluateBlobEnvRequirements(
  snapshot: BlobEnvSnapshot,
  options: BlobEnvAssertionOptions,
): RequirementCheck[] {
  return REQUIREMENTS.map((definition) => {
    const raw = snapshot[definition.key]
    const present = hasValue(raw)
    const enforced =
      definition.baseRequired ||
      (definition.enforceOption === 'requireToken' && Boolean(options.requireToken)) ||
      (definition.enforceOption === 'requireApiUrl' && Boolean(options.requireApiUrl))

    const severity: RequirementSeverity = present
      ? 'ok'
      : enforced
      ? 'error'
      : definition.warnWhenMissing
      ? 'warn'
      : 'info'

    const enforcedBy: RequirementEnforcement | null = enforced
      ? definition.baseRequired
        ? 'always'
        : definition.enforceOption ?? null
      : null

    const check: RequirementCheck = {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      required: enforced,
      present,
      severity,
      enforcedBy,
      valuePreview: previewRequirementValue(definition.key, raw),
    }

    logBlobDiagnostic('log', 'blob-env-check', {
      note: options.note,
      requirement: check,
    })

    return check
  })
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

type DiagnosticPayload = Record<string, unknown> | undefined

export function logBlobDiagnostic(level: 'log' | 'error', event: string, payload?: DiagnosticPayload) {
  const timestamp = new Date().toISOString()
  const basePayload =
    payload && typeof payload === 'object'
      ? 'env' in payload
        ? payload
        : { ...payload, env: describeBlobEnvSnapshot() }
      : { env: describeBlobEnvSnapshot() }

  if (level === 'error') {
    console.error('[diagnostic]', timestamp, event, basePayload)
  } else {
    console.log('[diagnostic]', timestamp, event, basePayload)
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
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

function coerceBoolean(value: string | undefined | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

export function isForceProdBlobsEnabled(): boolean {
  return coerceBoolean(process.env.FORCE_PROD_BLOBS)
}

function maskValue(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  if (trimmed.length <= 8) return trimmed
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

export function snapshotRequiredBlobEnv(): BlobEnvSnapshot {
  return SNAPSHOT_KEYS.reduce<BlobEnvSnapshot>((acc, key) => {
    const raw = process.env[key]
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      acc[key] = trimmed.length ? trimmed : undefined
    } else {
      acc[key] = undefined
    }
    return acc
  }, {} as BlobEnvSnapshot)
}

export function describeBlobEnvSnapshot(
  snapshot: BlobEnvSnapshot = snapshotRequiredBlobEnv(),
) {
  return {
    NETLIFY_BLOBS_API_URL: snapshot.NETLIFY_BLOBS_API_URL || null,
    NETLIFY_BLOBS_SITE_ID: maskValue(snapshot.NETLIFY_BLOBS_SITE_ID),
    NETLIFY_BLOBS_STORE: snapshot.NETLIFY_BLOBS_STORE || null,
    NETLIFY_BLOBS_TOKEN: snapshot.NETLIFY_BLOBS_TOKEN
      ? `${snapshot.NETLIFY_BLOBS_TOKEN.length} chars`
      : null,
    FORCE_PROD_BLOBS: isForceProdBlobsEnabled(),
  }
}

export function assertBlobEnv(options: BlobEnvAssertionOptions = {}) {
  const snapshot = options.snapshot ?? snapshotRequiredBlobEnv()
  const checks = evaluateBlobEnvRequirements(snapshot, options)
  const missing = checks
    .filter((check) => check.required && !check.present)
    .map((check) => check.key)

  const strictFailure = checks.some((check) => check.required && check.severity === 'error')

  const payload = {
    env: describeBlobEnvSnapshot(snapshot),
    missing,
    note: options.note,
    checks,
    strictFailure,
  }

  logBlobDiagnostic('log', 'blob-env-assertion', payload)

  if (missing.length) {
    const error = new Error('Missing blob env: ' + missing.join(', '))
    logBlobDiagnostic('error', 'blob-env-missing', {
      ...payload,
      error: error.message,
    })
    throw error
  }
}

function trimOptionalEnv(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function redactOptions(options: GetStoreOptions & { token?: string }) {
  const redacted: Record<string, unknown> = { ...options }
  if ('token' in redacted && typeof redacted.token === 'string') {
    redacted.token = `${redacted.token.length} chars`
  }
  return redacted
}

export async function safeBlobStore(): Promise<Store> {
  const snapshot = snapshotRequiredBlobEnv()
  let deploymentMetadata: DeploymentMetadata
  try {
    deploymentMetadata = resolveDeploymentMetadata()
  } catch (error) {
    logBlobDiagnostic('error', 'safe-blob-store-deploy-metadata-missing', {
      error: serializeError(error),
    })
    throw error instanceof Error
      ? error
      : new Error('Failed to resolve deployment metadata for blob initialization.')
  }

  logBlobDiagnostic('log', 'safe-blob-store-env-snapshot', {
    note: 'Preparing Netlify blob store initialization via safeBlobStore',
    deployID: deploymentMetadata.deployId,
    deployIDSource: deploymentMetadata.deployIdSource,
  })

  assertBlobEnv({
    snapshot,
    note: 'safeBlobStore initialization requires explicit env configuration',
    requireApiUrl: true,
    requireToken: true,
  })

  const storeName = snapshot.NETLIFY_BLOBS_STORE
  const siteId = snapshot.NETLIFY_BLOBS_SITE_ID
  const token = trimOptionalEnv(snapshot.NETLIFY_BLOBS_TOKEN)
  const apiUrl = trimOptionalEnv(snapshot.NETLIFY_BLOBS_API_URL)

  if (!storeName || !siteId || !token || !apiUrl) {
    const message =
      'safeBlobStore is missing required configuration after validation. Check Netlify blob env variables.'
    logBlobDiagnostic('error', 'safe-blob-store-invariant-missing', {
      error: message,
    })
    throw new Error(message)
  }

  const options: GetStoreOptions = {
    name: storeName,
    siteID: siteId,
    token,
    apiURL: apiUrl,
  }

  options.deployID = deploymentMetadata.deployId

  logBlobDiagnostic('log', 'safe-blob-store-options', {
    note: 'Attempting to initialize Netlify blob store',
    options: redactOptions(options),
    deploymentMetadata,
  })

  try {
    const store = getStore(options)
    logBlobDiagnostic('log', 'safe-blob-store-success', {
      note: 'Netlify blob store initialized successfully',
      options: redactOptions(options),
    })
    return store
  } catch (error) {
    const serializedError =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: 'Unknown error', value: error }

    logBlobDiagnostic('error', 'safe-blob-store-failure', {
      note: 'Failed to initialize Netlify blob store',
      error: serializedError,
      options: redactOptions(options),
    })

    throw new Error(`Failed to initialize Netlify blob store: ${serializedError.message}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}
