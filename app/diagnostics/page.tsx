'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DeploymentMetadata } from '@/types/deployment'

type TestKey = 'health' | 'storage' | 'google' | 'openai' | 'tues' | 'smoke' | 'e2e' | 'email'
type TestResult = { status: 'idle' | 'pending' | 'ok' | 'error'; message?: string }
type FoxRecord = {
  id: string
  theory: number
  level: 'info' | 'warn' | 'error'
  message: string
  details?: Record<string, unknown>
  count: number
  firstTriggeredAt: string
  lastTriggeredAt: string
}

type TranscriptSynopsis = {
  text: string
  turn: number
  at: string
  isEmpty: boolean
  reason?: string
  meta?: {
    started?: boolean
    manualStop?: boolean
    stopReason?: string
  }
  provider?: string | null
}

type ProviderErrorSynopsis = {
  status: number | null
  message: string
  reason?: string
  snippet?: string
  at: string
  resolved?: boolean
  resolvedAt?: string
}

type DeploymentSnapshot = {
  origin?: string
  host?: string
  href?: string
  pathname?: string
  releaseId?: string
  deployId?: string
  environment?: string
  deployUrl?: string
  siteUrl?: string
  branch?: string
  projectId?: string
  orgId?: string
}

type BlobFlowStep = {
  id: string
  label: string
  ok: boolean
  optional?: boolean
  skipped?: boolean
  method?: string
  url?: string
  status?: number
  durationMs?: number
  message?: string
  note?: string
  error?: string
  responseSnippet?: string
}

type BlobFlowDiagnostics = {
  ok: boolean
  probeId?: string
  startedAt?: string
  origin?: string
  sdkPath?: string
  sdkUrl?: string
  sitePutPath?: string
  directApiPath?: string
  steps: BlobFlowStep[]
}

declare global {
  interface Window {
    __DEPLOYMENT_METADATA__?: DeploymentMetadata
  }
}

type EnvDumpEntry = {
  key: string
  value: string | null
  severity: 'ok' | 'warn' | 'error' | 'info'
  message: string | null
}

type EnvDumpSummary = {
  total: number
  errors: number
  warnings: number
}

const diagnosticsTimestamp = () => new Date().toISOString()

function readClientEnvSummary(additional?: Record<string, unknown>) {
  const browserSummary = typeof window !== 'undefined'
    ? {
        origin: window.location.origin,
        pathname: window.location.pathname,
      }
    : {
        origin: null,
        pathname: null,
      }

  const deployment: DeploymentMetadata | null =
    typeof window !== 'undefined' && window.__DEPLOYMENT_METADATA__
      ? window.__DEPLOYMENT_METADATA__
      : null

  return {
    timestamp: diagnosticsTimestamp(),
    deployId: deployment?.deployId ?? null,
    environment: deployment?.environment ?? null,
    deployUrl: deployment?.deployUrl ?? null,
    siteUrl: deployment?.siteUrl ?? null,
    projectId: deployment?.projectId ?? null,
    orgId: deployment?.orgId ?? null,
    branch: deployment?.branch ?? null,
    ...browserSummary,
    ...(additional ?? {}),
  }
}

function logClientDiagnostics(
  level: 'log' | 'error',
  step: string,
  payload?: Record<string, unknown>,
) {
  const envSummary = readClientEnvSummary(payload?.envSummary as Record<string, unknown> | undefined)
  const merged = { ...payload, envSummary }
  if (level === 'error') {
    console.error('[diagnostic]', diagnosticsTimestamp(), step, merged)
  } else {
    console.log('[diagnostic]', diagnosticsTimestamp(), step, merged)
  }
}

const TRANSCRIPT_STORAGE_KEY = 'diagnostics:lastTranscript'
const PROVIDER_ERROR_STORAGE_KEY = 'diagnostics:lastProviderError'

const TEST_CONFIG: Record<TestKey, { label: string; path: string; method: 'GET' | 'POST' }> = {
  health: { label: 'Health check', path: '/api/health', method: 'GET' },
  storage: { label: 'Storage check', path: '/api/diagnostics/storage', method: 'GET' },
  google: { label: 'Google AI API check', path: '/api/diagnostics/google', method: 'GET' },
  openai: { label: 'OpenAI API check', path: '/api/diagnostics/openai', method: 'GET' },
  tues: { label: 'TUES credential check', path: '/api/diagnostics/tues', method: 'POST' },
  smoke: { label: 'Smoke test', path: '/api/diagnostics/smoke', method: 'POST' },
  e2e: { label: 'End-to-end test', path: '/api/diagnostics/e2e', method: 'POST' },
  email: { label: 'Email test', path: '/api/diagnostics/email', method: 'POST' },
}

const TEST_ORDER: TestKey[] = ['health', 'storage', 'google', 'openai', 'tues', 'smoke', 'e2e', 'email']

function initialResults(): Record<TestKey, TestResult> {
  return {
    health: { status: 'idle' },
    storage: { status: 'idle' },
    google: { status: 'idle' },
    openai: { status: 'idle' },
    tues: { status: 'idle' },
    smoke: { status: 'idle' },
    e2e: { status: 'idle' },
    email: { status: 'idle' },
  }
}

function describeBlobDetails(raw: any): string[] {
  if (!raw || typeof raw !== 'object') return []
  const details = raw as Record<string, any>
  const parts: string[] = []

  if (typeof details.action === 'string' && details.action.length) {
    parts.push(`action ${details.action}`)
  }
  if (typeof details.target === 'string' && details.target.length) {
    parts.push(`target ${details.target}`)
  }
  if (typeof details.store === 'string' && details.store.length) {
    parts.push(`store ${details.store}`)
  }
  if (typeof details.siteSlug === 'string' && details.siteSlug.length) {
    parts.push(`site ${details.siteSlug}`)
  } else if (typeof details.siteName === 'string' && details.siteName.length) {
    parts.push(`site ${details.siteName}`)
  } else if (typeof details.siteId === 'string' && details.siteId.length) {
    parts.push(`site ${details.siteId}`)
  }
  if (typeof details.tokenSource === 'string' && details.tokenSource.length) {
    parts.push(`token from ${details.tokenSource}`)
  }
  if (typeof details.tokenLength === 'number' && Number.isFinite(details.tokenLength)) {
    parts.push(`token length ${details.tokenLength}`)
  }
  if (Array.isArray(details.missing) && details.missing.length) {
    const missingLabels = details.missing
      .filter(
        (item: unknown): item is string => typeof item === 'string' && item.length > 0,
      )
      .join(', ')
    if (missingLabels.length) {
      parts.push(`missing ${missingLabels}`)
    }
  }
  if (typeof details.usingContext === 'boolean') {
    parts.push(details.usingContext ? 'context payload detected' : 'context payload missing')
  }
  if (Array.isArray(details.contextKeys) && details.contextKeys.length) {
    const contextKeys = details.contextKeys
      .filter(
        (item: unknown): item is string => typeof item === 'string' && item.length > 0,
      )
      .slice(0, 4)
    if (contextKeys.length) {
      parts.push(`context keys ${contextKeys.join(', ')}`)
    }
  }
  if (typeof details.status === 'number' && Number.isFinite(details.status)) {
    parts.push(`status ${details.status}`)
  }
  if (typeof details.code === 'string' && details.code.length) {
    parts.push(`code ${details.code}`)
  }
  if (typeof details.requestId === 'string' && details.requestId.length) {
    parts.push(`request ${details.requestId}`)
  }
  if (typeof details.responseBodySnippet === 'string' && details.responseBodySnippet.length) {
    parts.push(`body: ${details.responseBodySnippet}`)
  }
  if (typeof details.originalMessage === 'string' && details.originalMessage.length) {
    parts.push(`origin: ${details.originalMessage}`)
  }

  return parts
}

function readDeploymentSnapshot(): DeploymentSnapshot | null {
  if (typeof window === 'undefined') return null

  const snapshot: DeploymentSnapshot = {}
  const { location } = window

  if (location) {
    if (typeof location.origin === 'string' && location.origin.length) {
      snapshot.origin = location.origin
    }
    if (typeof location.host === 'string' && location.host.length) {
      snapshot.host = location.host
    }
    if (typeof location.href === 'string' && location.href.length) {
      snapshot.href = location.href
    }
    if (typeof location.pathname === 'string' && location.pathname.length) {
      snapshot.pathname = location.pathname
    }
  }

  const nextData = (window as any).__NEXT_DATA__
  if (nextData && typeof nextData === 'object') {
    if (typeof nextData.buildId === 'string' && nextData.buildId.length) {
      snapshot.releaseId = nextData.buildId
    }
  }

  const deploymentMetadata = window.__DEPLOYMENT_METADATA__
  if (deploymentMetadata) {
    if (typeof deploymentMetadata.deployId === 'string' && deploymentMetadata.deployId.length) {
      snapshot.deployId = deploymentMetadata.deployId
    }
    if (typeof deploymentMetadata.environment === 'string' && deploymentMetadata.environment.length) {
      snapshot.environment = deploymentMetadata.environment
    }
    if (typeof deploymentMetadata.deployUrl === 'string' && deploymentMetadata.deployUrl.length) {
      snapshot.deployUrl = deploymentMetadata.deployUrl
    }
    if (typeof deploymentMetadata.siteUrl === 'string' && deploymentMetadata.siteUrl.length) {
      snapshot.siteUrl = deploymentMetadata.siteUrl
    }
    if (typeof deploymentMetadata.branch === 'string' && deploymentMetadata.branch.length) {
      snapshot.branch = deploymentMetadata.branch
    }
    if (typeof deploymentMetadata.projectId === 'string' && deploymentMetadata.projectId.length) {
      snapshot.projectId = deploymentMetadata.projectId
    }
    if (typeof deploymentMetadata.orgId === 'string' && deploymentMetadata.orgId.length) {
      snapshot.orgId = deploymentMetadata.orgId
    }
  }

  return snapshot
}

function summarizeSupabaseDiagnostics(raw: any, deployment?: DeploymentSnapshot | null): string[] {
  if (!raw || typeof raw !== 'object') return []
  const summary: string[] = []

  const mode = typeof raw.mode === 'string' && raw.mode.length ? raw.mode : 'unknown'
  summary.push(`Mode: ${mode}`)

  if (typeof raw.supabaseBucket === 'string' && raw.supabaseBucket.length) {
    summary.push(`Bucket: ${raw.supabaseBucket}`)
  }
  if (typeof raw.supabaseUrl === 'string' && raw.supabaseUrl.length) {
    summary.push(`URL: ${raw.supabaseUrl}`)
  }
  if (typeof raw.supabaseServiceRoleKey === 'string' && raw.supabaseServiceRoleKey.length) {
    summary.push(`Service role key: ${raw.supabaseServiceRoleKey}`)
  }
  if (typeof raw.secretsSource === 'string' && raw.secretsSource.length) {
    summary.push(`Secrets source: ${raw.secretsSource}`)
  }

  if (deployment) {
    const originLabel = deployment.origin || deployment.host
    if (originLabel) {
      summary.push(`Deployment origin: ${originLabel}`)
    }
    if (deployment.href) {
      summary.push(`Deployment URL: ${deployment.href}`)
    }
    if (deployment.pathname) {
      summary.push(`Deployment path: ${deployment.pathname}`)
    }
    if (deployment.environment) {
      summary.push(`Environment: ${deployment.environment}`)
    }
    if (deployment.branch) {
      summary.push(`Branch: ${deployment.branch}`)
    }
    if (deployment.deployUrl) {
      summary.push(`Deploy URL: ${deployment.deployUrl}`)
    }
    if (deployment.siteUrl) {
      summary.push(`Site URL: ${deployment.siteUrl}`)
    }
    if (deployment.deployId) {
      summary.push(`Deploy ID: ${deployment.deployId}`)
    }
    if (deployment.releaseId) {
      summary.push(`Build ID: ${deployment.releaseId}`)
    }
    if (deployment.projectId) {
      summary.push(`Project ID: ${deployment.projectId}`)
    }
    if (deployment.orgId) {
      summary.push(`Org ID: ${deployment.orgId}`)
    }
  }

  return summary
}

function formatSummary(key: TestKey, data: any): string {
  if (!data || typeof data !== 'object') return ''

  if (key === 'health') {
    const env = data.env || {}
    const blob = data.blob || {}
    const db = data.db || {}
    const storageLabel = env.hasBlobStore
      ? env.storageBucket
        ? `${env.storageProvider || 'supabase'} (${env.storageBucket})`
        : env.storageProvider || 'configured'
      : env.storageProvider === 'memory'
      ? 'memory fallback'
      : env.storageProvider || 'unconfigured'
    const parts = [
      `OpenAI: ${env.hasOpenAI ? 'yes' : 'no'}`,
      `Storage: ${storageLabel}`,
      `Resend: ${env.hasResend ? 'yes' : 'no'}`,
    ]
    if (blob) parts.push(`Storage health: ${blob.ok ? 'ok' : blob.reason || 'error'}`)
    if (db) parts.push(`DB: ${db.ok ? db.mode || 'ok' : db.reason || 'error'}`)
    if (env?.blobDiagnostics) {
      const diagParts: string[] = []
      if (env.blobDiagnostics.mode) diagParts.push(`mode=${env.blobDiagnostics.mode}`)
      if (env.blobDiagnostics.supabaseBucket) diagParts.push(`bucket=${env.blobDiagnostics.supabaseBucket}`)
      if (env.blobDiagnostics.supabaseServiceRoleKey) {
        diagParts.push(`serviceRole=${env.blobDiagnostics.supabaseServiceRoleKey}`)
      }
    if (env.blobDiagnostics.secretsSource) {
      diagParts.push(`secrets=${env.blobDiagnostics.secretsSource}`)
    }
      parts.push(`Storage diag: ${diagParts.length ? diagParts.join(' · ') : 'no diagnostics available'}`)
    }
    return parts.join(' · ')
  }

  if (key === 'storage') {
    const diagnostics = data?.env?.diagnostics ?? {}
    const detailParts: string[] = []
    if (diagnostics.mode) detailParts.push(`mode ${diagnostics.mode}`)
    if (diagnostics.supabaseBucket) detailParts.push(`bucket ${diagnostics.supabaseBucket}`)
    if (diagnostics.supabaseServiceRoleKey) {
      detailParts.push(`service role ${diagnostics.supabaseServiceRoleKey}`)
    }
    if (diagnostics.supabaseUrl) detailParts.push(`url ${diagnostics.supabaseUrl}`)
    if (diagnostics.secretsSource) detailParts.push(`secrets ${diagnostics.secretsSource}`)
    const flow: BlobFlowDiagnostics | undefined = Array.isArray(data?.flow?.steps)
      ? (data.flow as BlobFlowDiagnostics)
      : undefined
    if (flow && Array.isArray(flow.steps) && flow.steps.length) {
      const stepSummary = flow.steps.map(step => {
        const status = typeof step.status === 'number' ? ` ${step.status}` : ''
        const method = step.method ? `${step.method} ` : ''
        const flag = step.skipped ? '⏭️' : step.ok ? '✅' : '❌'
        return `${flag} ${method}${step.id || step.label || 'step'}${status}`
      })
      detailParts.push(`flow: ${stepSummary.join(' · ')}`)
      if (!flow.ok) {
        const failingStep = flow.steps.find(step => !step.ok && !step.optional && !step.skipped)
        if (failingStep) {
          const label = failingStep.label || failingStep.id || 'unknown step'
          const status = typeof failingStep.status === 'number' ? ` (HTTP ${failingStep.status})` : ''
          detailParts.push(`flow failure: ${label}${status}`)
        }
      }
    }
    const healthDetails = data?.health?.details
    if (healthDetails) {
      const detailSnippets = describeBlobDetails(healthDetails)
      if (detailSnippets.length) {
        detailParts.push(...detailSnippets.map(snippet => `health ${snippet}`))
      }
    }
    if (typeof data?.message === 'string') {
      return detailParts.length ? `${data.message} · ${detailParts.join(' · ')}` : data.message
    }
    if (data?.env?.provider === 'supabase' && data?.ok) {
      const bucket = data?.env?.bucket || data?.env?.storageBucket
      const label = bucket ? `Supabase storage ready (${bucket})` : 'Supabase storage ready.'
      return detailParts.length ? `${label} · ${detailParts.join(' · ')}` : label
    }
    if (data?.env?.provider === 'memory') {
      return detailParts.length
        ? `Using in-memory storage fallback · ${detailParts.join(' · ')}`
        : 'Using in-memory storage fallback.'
    }
    if (data?.health?.reason) return `Error: ${data.health.reason}`
    return data?.ok ? 'Storage check passed' : 'Storage check failed'
  }

  if (key === 'google') {
    if (data.ok) {
      const model = data.model || {}
      const replyText = typeof data.reply === 'string' ? data.reply.trim() : ''
      const replySnippet = replyText.length > 60 ? `${replyText.slice(0, 57)}…` : replyText
      const reply = replySnippet ? ` · Reply: ${replySnippet}` : ''
      return `Model: ${model.name || model.id || 'unknown'}${reply}`
    }
    if (data.error) return `Error: ${data.error}`
    if (data.status && data.message) return `HTTP ${data.status}: ${data.message}`
  }

  if (key === 'openai') {
    if (data.ok) {
      const modelId = data.model?.id || data.model || 'unknown model'
      const replyText = typeof data.reply === 'string' ? data.reply.trim() : ''
      const replySnippet = replyText.length > 60 ? `${replyText.slice(0, 57)}…` : replyText
      const reply = replySnippet ? ` · Reply: ${replySnippet}` : ''
      return `Model: ${modelId}${reply}`
    }
    if (data.error) return `Error: ${data.error}`
    if (data.status && data.message) return `HTTP ${data.status}: ${data.message}`
  }

  if (key === 'email') {
    const status = data.status || {}
    if (status.ok) return `Email sent via ${status.provider || 'configured provider'}`
    if (status.skipped) return 'Email skipped (no provider configured)'
  }

  if (key === 'smoke') {
    if (data.ok) return 'Session created and finalized'
    const detailParts: string[] = []
    if (data.stage) detailParts.push(`stage ${data.stage}`)
    if (data.cause) detailParts.push(`cause: ${data.cause}`)
    const blobDetails = data.details || data.blobDetails
    if (blobDetails) {
      detailParts.push(...describeBlobDetails(blobDetails))
    }
    return detailParts.length
      ? `${data.error || 'Smoke test failed'} · ${detailParts.join(' · ')}`
      : data.error || 'Smoke test failed'
  }
  if (key === 'e2e') {
    if (data.ok) return 'Session completed end-to-end'
    const detailParts: string[] = []
    if (data.stage) detailParts.push(`stage ${data.stage}`)
    if (data.cause) detailParts.push(`cause: ${data.cause}`)
    const blobDetails = data.details || data.blobDetails
    if (blobDetails) {
      detailParts.push(...describeBlobDetails(blobDetails))
    }
    return detailParts.length
      ? `${data.error || 'E2E test failed'} · ${detailParts.join(' · ')}`
      : data.error || 'E2E test failed'
  }

  if (data.error) return `Error: ${data.error}`
  return data.ok ? 'Passed' : 'Failed'
}

export default function DiagnosticsPage() {
  const [latestTranscript, setLatestTranscript] = useState<TranscriptSynopsis | null>(null)
  const [latestProviderError, setLatestProviderError] = useState<ProviderErrorSynopsis | null>(null)
  const [envDump, setEnvDump] = useState<EnvDumpEntry[] | null>(null)
  const [envSummary, setEnvSummary] = useState<EnvDumpSummary | null>(null)
  const [envError, setEnvError] = useState<string | null>(null)
  const [log, setLog] = useState<string>('Ready. Run diagnostics to gather fresh results.')
  const [results, setResults] = useState<Record<TestKey, TestResult>>(() => initialResults())
  const [isRunning, setIsRunning] = useState(false)
  const [foxes, setFoxes] = useState<FoxRecord[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const url = '/api/diagnostics/env?format=json'

    logClientDiagnostics('log', 'diagnostics:env-dump:fetch:start', {
      request: { url, method: 'GET', accept: 'application/json' },
    })

    async function loadEnvDump() {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json' } })
        const payload = await response.json()

        if (!response.ok || (payload && typeof payload === 'object' && payload.ok === false)) {
          const detail =
            payload && typeof payload === 'object' && typeof (payload as any).error === 'string'
              ? (payload as any).error
              : `HTTP ${response.status}`
          throw new Error(detail)
        }

        if (!payload || typeof payload !== 'object' || !Array.isArray((payload as any).env)) {
          throw new Error('Malformed environment diagnostics payload')
        }

        const entriesRaw = (payload as any).env as any[]
        const sanitizedEntries: EnvDumpEntry[] = entriesRaw.map((item) => {
          const rawKey = typeof item?.key === 'string' ? item.key : String(item?.key ?? '')
          const key = rawKey && rawKey.length ? rawKey : '(unnamed)'
          const rawValue = item?.value
          const value =
            rawValue === null || rawValue === undefined
              ? null
              : typeof rawValue === 'string'
              ? rawValue
              : String(rawValue)
          const rawSeverity = typeof item?.severity === 'string' ? item.severity.toLowerCase() : 'info'
          const severity: EnvDumpEntry['severity'] = ['ok', 'warn', 'error', 'info'].includes(rawSeverity)
            ? (rawSeverity as EnvDumpEntry['severity'])
            : 'info'
          const message =
            item?.message === null || item?.message === undefined
              ? null
              : typeof item.message === 'string'
              ? item.message
              : String(item.message)
          return { key, value, severity, message }
        })
        sanitizedEntries.sort((a, b) => a.key.localeCompare(b.key))

        const summarySource = (payload as any).summary
        const summary: EnvDumpSummary | null =
          summarySource && typeof summarySource === 'object'
            ? {
                total: (() => {
                  if (typeof summarySource.total === 'number' && Number.isFinite(summarySource.total)) {
                    return summarySource.total
                  }
                  if (typeof summarySource.total === 'string') {
                    const parsed = Number(summarySource.total)
                    if (Number.isFinite(parsed)) return parsed
                  }
                  return sanitizedEntries.length
                })(),
                errors: (() => {
                  if (typeof summarySource.errors === 'number' && Number.isFinite(summarySource.errors)) {
                    return summarySource.errors
                  }
                  if (typeof summarySource.errors === 'string') {
                    const parsed = Number(summarySource.errors)
                    if (Number.isFinite(parsed)) return parsed
                  }
                  return 0
                })(),
                warnings: (() => {
                  if (
                    typeof summarySource.warnings === 'number' &&
                    Number.isFinite(summarySource.warnings)
                  ) {
                    return summarySource.warnings
                  }
                  if (typeof summarySource.warnings === 'string') {
                    const parsed = Number(summarySource.warnings)
                    if (Number.isFinite(parsed)) return parsed
                  }
                  return 0
                })(),
              }
            : {
                total: sanitizedEntries.length,
                errors: 0,
                warnings: 0,
              }

        if (!cancelled) {
          setEnvDump(sanitizedEntries)
          setEnvSummary(summary)
          setEnvError(null)
        }

        const severityCounts = sanitizedEntries.reduce(
          (acc, entry) => {
            acc.total += 1
            acc.bySeverity[entry.severity] = (acc.bySeverity[entry.severity] ?? 0) + 1
            return acc
          },
          { total: 0, bySeverity: { ok: 0, warn: 0, error: 0, info: 0 } as Record<EnvDumpEntry['severity'], number> },
        )

        const collectIssues = (keys: string[]) =>
          sanitizedEntries.filter(
            (entry) => keys.includes(entry.key) && (entry.severity === 'warn' || entry.severity === 'error'),
          )

        const hypothesisEvaluations = [
          {
            hypothesis: 'Required environment variables might be missing or using fallback placeholders.',
            confirmed: severityCounts.bySeverity.error > 0,
            evidence: sanitizedEntries
              .filter((entry) => entry.severity === 'error')
              .map((entry) => ({ key: entry.key, message: entry.message })),
          },
          {
            hypothesis: 'Supabase storage credentials may be missing or misconfigured.',
            confirmed: collectIssues([
              'STORAGE_MODE',
              'SUPABASE_URL',
              'SUPABASE_STORAGE_BUCKET',
              'SUPABASE_SERVICE_ROLE_KEY',
              'SUPABASE_ANON_KEY',
            ]).length > 0,
            evidence: collectIssues([
              'STORAGE_MODE',
              'SUPABASE_URL',
              'SUPABASE_STORAGE_BUCKET',
              'SUPABASE_SERVICE_ROLE_KEY',
              'SUPABASE_ANON_KEY',
            ]).map((entry) => ({ key: entry.key, severity: entry.severity, message: entry.message })),
          },
          {
            hypothesis: 'Email delivery could be disabled because provider API keys are absent.',
            confirmed: collectIssues([
              'DEFAULT_NOTIFY_EMAIL',
              'RESEND_API_KEY',
              'SENDGRID_API_KEY',
              'ENABLE_SESSION_EMAILS',
            ]).length > 0,
            evidence: collectIssues([
              'DEFAULT_NOTIFY_EMAIL',
              'RESEND_API_KEY',
              'SENDGRID_API_KEY',
              'ENABLE_SESSION_EMAILS',
            ]).map((entry) => ({ key: entry.key, severity: entry.severity, message: entry.message })),
          },
          {
            hypothesis: 'Google AI access may fail if the API key or model name is unset.',
            confirmed: collectIssues(['GOOGLE_API_KEY', 'GOOGLE_MODEL']).length > 0,
            evidence: collectIssues(['GOOGLE_API_KEY', 'GOOGLE_MODEL']).map((entry) => ({
              key: entry.key,
              severity: entry.severity,
              message: entry.message,
            })),
          },
        ]

        logClientDiagnostics('log', 'diagnostics:env-dump:fetch:success', {
          response: { status: response.status },
          summary,
          severityCounts,
          hypothesisEvaluations,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        logClientDiagnostics('error', 'diagnostics:env-dump:fetch:error', {
          request: { url },
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
          detail: message,
        })
        if (!cancelled) {
          setEnvError(message)
          setEnvDump([])
          setEnvSummary(null)
        }
      }
    }

    void loadEnvDump()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () => {
      if (typeof window === 'undefined') {
        logClientDiagnostics('log', 'diagnostics:transcript:storage-read:skipped', {
          reason: 'window undefined',
        })
        return
      }

      try {
        logClientDiagnostics('log', 'diagnostics:transcript:storage-read:start', {
          storageKey: TRANSCRIPT_STORAGE_KEY,
        })
        const raw = window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY)
        if (!raw) {
          setLatestTranscript(null)
          logClientDiagnostics('log', 'diagnostics:transcript:storage-read:empty', {
            storageKey: TRANSCRIPT_STORAGE_KEY,
          })
        } else {
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== 'object') {
            setLatestTranscript(null)
            logClientDiagnostics('log', 'diagnostics:transcript:storage-read:invalid', {
              storageKey: TRANSCRIPT_STORAGE_KEY,
            })
          } else {
            const payload: TranscriptSynopsis = {
              text: typeof (parsed as any).text === 'string' ? (parsed as any).text : '',
              turn: typeof (parsed as any).turn === 'number' ? (parsed as any).turn : 0,
              at: typeof (parsed as any).at === 'string' ? (parsed as any).at : '',
              isEmpty: Boolean((parsed as any).isEmpty),
              reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason : undefined,
              meta:
                (parsed as any).meta && typeof (parsed as any).meta === 'object'
                  ? {
                      started:
                        typeof (parsed as any).meta.started === 'boolean'
                          ? (parsed as any).meta.started
                          : undefined,
                      manualStop:
                        typeof (parsed as any).meta.manualStop === 'boolean'
                          ? (parsed as any).meta.manualStop
                          : undefined,
                      stopReason:
                        typeof (parsed as any).meta.stopReason === 'string'
                          ? (parsed as any).meta.stopReason
                          : undefined,
                    }
                  : undefined,
              provider:
                typeof (parsed as any).provider === 'string'
                  ? (parsed as any).provider
                  : (parsed as any).provider === null
                  ? null
                  : undefined,
            }
            setLatestTranscript(payload)
            logClientDiagnostics('log', 'diagnostics:transcript:storage-read:success', {
              storageKey: TRANSCRIPT_STORAGE_KEY,
              transcript: {
                isEmpty: payload.isEmpty,
                turn: payload.turn,
                at: payload.at,
                provider: payload.provider,
              },
            })
          }
        }
      } catch (error) {
        logClientDiagnostics('error', 'diagnostics:transcript:storage-read:error', {
          storageKey: TRANSCRIPT_STORAGE_KEY,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: 'Unknown error', value: error },
        })
        setLatestTranscript(null)
      }

      try {
        logClientDiagnostics('log', 'diagnostics:provider-error:storage-read:start', {
          storageKey: PROVIDER_ERROR_STORAGE_KEY,
        })
        const rawError = window.localStorage.getItem(PROVIDER_ERROR_STORAGE_KEY)
        if (!rawError) {
          setLatestProviderError(null)
          logClientDiagnostics('log', 'diagnostics:provider-error:storage-read:empty', {
            storageKey: PROVIDER_ERROR_STORAGE_KEY,
          })
        } else {
          const parsedError = JSON.parse(rawError)
          if (!parsedError || typeof parsedError !== 'object') {
            setLatestProviderError(null)
            logClientDiagnostics('log', 'diagnostics:provider-error:storage-read:invalid', {
              storageKey: PROVIDER_ERROR_STORAGE_KEY,
            })
          } else {
            const rawStatus =
              typeof (parsedError as any).status === 'number'
                ? (parsedError as any).status
                : typeof (parsedError as any).status === 'string'
                ? Number.parseInt((parsedError as any).status, 10)
                : null
            const normalizedStatus =
              typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : null
            const snapshot: ProviderErrorSynopsis = {
              status: normalizedStatus,
              message: typeof (parsedError as any).message === 'string' ? (parsedError as any).message : 'Unknown error',
              reason: typeof (parsedError as any).reason === 'string' ? (parsedError as any).reason : undefined,
              snippet: typeof (parsedError as any).snippet === 'string' ? (parsedError as any).snippet : undefined,
              at: typeof (parsedError as any).at === 'string' ? (parsedError as any).at : '',
              resolved: (parsedError as any).resolved === true,
              resolvedAt:
                typeof (parsedError as any).resolvedAt === 'string' ? (parsedError as any).resolvedAt : undefined,
            }
            setLatestProviderError(snapshot)
            logClientDiagnostics('log', 'diagnostics:provider-error:storage-read:success', {
              storageKey: PROVIDER_ERROR_STORAGE_KEY,
              providerError: {
                status: snapshot.status,
                resolved: snapshot.resolved,
                at: snapshot.at,
              },
            })
          }
        }
      } catch (error) {
        logClientDiagnostics('error', 'diagnostics:provider-error:storage-read:error', {
          storageKey: PROVIDER_ERROR_STORAGE_KEY,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: 'Unknown error', value: error },
        })
        setLatestProviderError(null)
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === TRANSCRIPT_STORAGE_KEY ||
        event.key === PROVIDER_ERROR_STORAGE_KEY
      ) {
        read()
      }
    }
    const handleFocus = () => {
      if (typeof document !== 'undefined') {
        if (document.visibilityState && document.visibilityState !== 'visible') return
      }
      read()
    }
    read()
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', handleFocus)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleFocus)
    }
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', handleFocus)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleFocus)
      }
    }
  }, [])

  const formatFlag = (value: boolean | undefined) =>
    value === true ? 'yes' : value === false ? 'no' : 'unknown'

  const append = (line: string) =>
    setLog((l) => (l && l.length > 0 ? l + '\n' + line : line))

  const statusIcon = useMemo(
    () => ({ idle: '•', pending: '…', ok: '✅', error: '❌' } as const),
    []
  )

  const updateResult = (key: TestKey, patch: Partial<TestResult>) => {
    setResults(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function runDiagnostics() {
    if (isRunning) return
    setIsRunning(true)
    setLog('Running diagnostics...')
    setResults(initialResults())
    setFoxes([])

    const resultStatusLog: Record<TestKey, TestResult['status']> = Object.fromEntries(
      TEST_ORDER.map((key) => [key, 'idle' as TestResult['status']]),
    ) as Record<TestKey, TestResult['status']>

    logClientDiagnostics('log', 'diagnostics:run:start', {
      tests: TEST_ORDER.map((key) => ({ key, path: TEST_CONFIG[key].path, method: TEST_CONFIG[key].method })),
    })

    let transcriptSnapshot: TranscriptSynopsis | null = null
    let providerSnapshot: ProviderErrorSynopsis | null = null
    if (typeof window !== 'undefined') {
      try {
        const rawTranscript = window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY)
        if (rawTranscript) {
          const parsedTranscript = JSON.parse(rawTranscript)
          if (parsedTranscript && typeof parsedTranscript === 'object') {
            transcriptSnapshot = {
              text: typeof (parsedTranscript as any).text === 'string' ? (parsedTranscript as any).text : '',
              turn: typeof (parsedTranscript as any).turn === 'number' ? (parsedTranscript as any).turn : 0,
              at: typeof (parsedTranscript as any).at === 'string' ? (parsedTranscript as any).at : '',
              isEmpty: Boolean((parsedTranscript as any).isEmpty),
              reason:
                typeof (parsedTranscript as any).reason === 'string'
                  ? (parsedTranscript as any).reason
                  : undefined,
              meta:
                (parsedTranscript as any).meta && typeof (parsedTranscript as any).meta === 'object'
                  ? {
                      started:
                        typeof (parsedTranscript as any).meta.started === 'boolean'
                          ? (parsedTranscript as any).meta.started
                          : undefined,
                      manualStop:
                        typeof (parsedTranscript as any).meta.manualStop === 'boolean'
                          ? (parsedTranscript as any).meta.manualStop
                          : undefined,
                      stopReason:
                        typeof (parsedTranscript as any).meta.stopReason === 'string'
                          ? (parsedTranscript as any).meta.stopReason
                          : undefined,
                    }
                  : undefined,
            }
          }
        }
      } catch (error) {
        logClientDiagnostics('error', 'diagnostics:run:transcript-snapshot:error', {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: 'Unknown error', value: error },
        })
      }

      try {
        const rawError = window.localStorage.getItem(PROVIDER_ERROR_STORAGE_KEY)
        if (rawError) {
          const parsed = JSON.parse(rawError)
          if (parsed && typeof parsed === 'object') {
            const rawStatus =
              typeof (parsed as any).status === 'number'
                ? (parsed as any).status
                : typeof (parsed as any).status === 'string'
                ? Number.parseInt((parsed as any).status, 10)
                : null
            const normalizedStatus =
              typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : null
            providerSnapshot = {
              status: normalizedStatus,
              message: typeof (parsed as any).message === 'string' ? (parsed as any).message : 'Unknown error',
              reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason : undefined,
              snippet: typeof (parsed as any).snippet === 'string' ? (parsed as any).snippet : undefined,
              at: typeof (parsed as any).at === 'string' ? (parsed as any).at : '',
              resolved: (parsed as any).resolved === true,
              resolvedAt:
                typeof (parsed as any).resolvedAt === 'string' ? (parsed as any).resolvedAt : undefined,
            }
          }
        }
      } catch (error) {
        logClientDiagnostics('error', 'diagnostics:run:provider-snapshot:error', {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: 'Unknown error', value: error },
        })
      }
    }

    const deploymentSnapshot = readDeploymentSnapshot()

    setLatestTranscript(transcriptSnapshot)
    if (providerSnapshot) {
      setLatestProviderError(providerSnapshot)
    } else {
      setLatestProviderError(null)
    }

    if (deploymentSnapshot) {
      const originLabel = deploymentSnapshot.origin || deploymentSnapshot.host || 'origin unknown'
      append(`[deployment] Origin: ${originLabel}`)
      if (deploymentSnapshot.href) {
        append(`[deployment] URL: ${deploymentSnapshot.href}`)
      }
      if (deploymentSnapshot.pathname) {
        append(`[deployment] Path: ${deploymentSnapshot.pathname}`)
      }
      if (deploymentSnapshot.environment) {
        append(`[deployment] Environment: ${deploymentSnapshot.environment}`)
      }
      if (deploymentSnapshot.branch) {
        append(`[deployment] Branch: ${deploymentSnapshot.branch}`)
      }
      if (deploymentSnapshot.deployUrl) {
        append(`[deployment] Deploy URL: ${deploymentSnapshot.deployUrl}`)
      }
      if (deploymentSnapshot.siteUrl) {
        append(`[deployment] Site URL: ${deploymentSnapshot.siteUrl}`)
      }
      if (deploymentSnapshot.deployId) {
        append(`[deployment] Deploy ID: ${deploymentSnapshot.deployId}`)
      }
      if (deploymentSnapshot.releaseId) {
        append(`[deployment] Build ID: ${deploymentSnapshot.releaseId}`)
      }
      if (deploymentSnapshot.projectId) {
        append(`[deployment] Project ID: ${deploymentSnapshot.projectId}`)
      }
      if (deploymentSnapshot.orgId) {
        append(`[deployment] Org ID: ${deploymentSnapshot.orgId}`)
      }
    } else {
      append('[deployment] Unable to determine current deployment origin from browser context.')
    }

    if (transcriptSnapshot) {
      const capturedAt =
        transcriptSnapshot.at && !Number.isNaN(Date.parse(transcriptSnapshot.at))
          ? new Date(transcriptSnapshot.at).toLocaleString()
          : 'time unknown'
      if (transcriptSnapshot.isEmpty) {
        const reasonLabel = transcriptSnapshot.reason
          ? ` (${String(transcriptSnapshot.reason).replace(/_/g, ' ')})`
          : ''
        append(`[transcript] Turn ${transcriptSnapshot.turn || '–'} at ${capturedAt}: no transcript${reasonLabel}.`)
      } else {
        append(
          `[transcript] Turn ${transcriptSnapshot.turn || '–'} at ${capturedAt}: "${transcriptSnapshot.text}"`,
        )
      }
      if (transcriptSnapshot.meta) {
        append(
          `[transcript] Meta → started=${formatFlag(transcriptSnapshot.meta.started)} · manual_stop=${formatFlag(
            transcriptSnapshot.meta.manualStop,
          )} · stop_reason=${transcriptSnapshot.meta.stopReason || 'unknown'}`,
        )
      }
    } else {
      append('[transcript] No transcript data captured yet.')
    }

    if (providerSnapshot) {
      const capturedAt = providerSnapshot.at && !Number.isNaN(Date.parse(providerSnapshot.at))
        ? new Date(providerSnapshot.at).toLocaleString()
        : 'time unknown'
      append(
        `[provider-error] ${
          providerSnapshot.status ? `HTTP ${providerSnapshot.status}` : 'Request failed'
        } at ${capturedAt} (${providerSnapshot.reason || 'reason unknown'})`,
      )
      if (providerSnapshot.resolved) {
        const resolvedAt =
          providerSnapshot.resolvedAt && !Number.isNaN(Date.parse(providerSnapshot.resolvedAt))
            ? new Date(providerSnapshot.resolvedAt).toLocaleString()
            : 'time unknown'
        append(`[provider-error] Resolved at ${resolvedAt}`)
      }
      if (providerSnapshot.snippet) {
        append(`[provider-error] Snippet: ${providerSnapshot.snippet}`)
      }
    } else {
      append('[provider-error] No provider errors recorded yet.')
    }

    for (const key of TEST_ORDER) {
      const { path, method } = TEST_CONFIG[key]
      updateResult(key, { status: 'pending', message: undefined })
      resultStatusLog[key] = 'pending'
      append(`→ ${path}`)
      logClientDiagnostics('log', 'diagnostics:test:start', {
        test: key,
        request: { path, method },
      })

      try {
        const res = await fetch(path, {
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        })
        logClientDiagnostics('log', 'diagnostics:test:response', {
          test: key,
          response: { status: res.status, ok: res.ok },
        })
        const rawText = await res.text()
        let parsed: any = null
        try {
          parsed = JSON.parse(rawText)
        } catch (err) {
          parsed = null
          logClientDiagnostics('log', 'diagnostics:test:parse-json-failed', {
            test: key,
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : { message: 'Unknown parse error', value: err },
          })
        }

        let normalizedMessage: string | undefined
        let normalizedOk = res.ok

        if (parsed) {
          append(JSON.stringify(parsed, null, 2))
          const ok = typeof parsed.ok === 'boolean' ? parsed.ok : res.ok
          normalizedOk = ok
          const message = formatSummary(key, parsed)
          normalizedMessage = message
          updateResult(key, { status: ok ? 'ok' : 'error', message })
          resultStatusLog[key] = ok ? 'ok' : 'error'
          if (key === 'storage') {
            const diagnosticsSummary = summarizeSupabaseDiagnostics(parsed?.env?.diagnostics, deploymentSnapshot)
            if (diagnosticsSummary.length) {
              append('***KEY NETFLIFY ITEMS***')
              diagnosticsSummary.forEach(line => append(line))
              append('***KEY NETFLIFY ITEMS***')
            }
            const flow = parsed?.flow as BlobFlowDiagnostics | undefined
            if (flow && Array.isArray(flow.steps) && flow.steps.length) {
              append('***BLOB FLOW STEPS***')
              const contextParts: string[] = []
              if (flow.probeId) contextParts.push(`probe=${flow.probeId}`)
              if (flow.sdkPath) contextParts.push(`sdk_path=${flow.sdkPath}`)
              if (flow.sitePutPath) contextParts.push(`site_put_path=${flow.sitePutPath}`)
              if (flow.directApiPath) contextParts.push(`direct_api_path=${flow.directApiPath}`)
              if (flow.origin) contextParts.push(`origin=${flow.origin}`)
              if (contextParts.length) {
                append(`[blob-flow] Context → ${contextParts.join(' · ')}`)
              }
              flow.steps.forEach(step => {
                const flag = step.skipped ? '⏭️' : step.ok ? '✅' : '❌'
                const method = step.method ? `${step.method} ` : ''
                const status = typeof step.status === 'number' ? ` (HTTP ${step.status})` : ''
                const url = step.url ? ` → ${step.url}` : ''
                const duration = typeof step.durationMs === 'number' ? ` · ${step.durationMs}ms` : ''
                const note = step.note ? ` · note: ${step.note}` : ''
                const error = step.error ? ` · error: ${step.error}` : ''
                const body = step.responseSnippet ? ` · body: ${step.responseSnippet}` : ''
                append(`${flag} ${method}${step.label || step.id}${status}${url}${duration}${note}${error}${body}`)
              })
              append('***BLOB FLOW STEPS***')
            }
          }
        } else {
          append(rawText || '(no response body)')
          normalizedMessage = res.ok ? 'Received response' : `HTTP ${res.status}`
          normalizedOk = res.ok
          updateResult(key, {
            status: res.ok ? 'ok' : 'error',
            message: normalizedMessage,
          })
          resultStatusLog[key] = res.ok ? 'ok' : 'error'
        }

        logClientDiagnostics('log', 'diagnostics:test:success', {
          test: key,
          response: { status: res.status, ok: normalizedOk },
          message: normalizedMessage,
        })
      } catch (e: any) {
        const errorMessage = e?.message || 'Request failed'
        append(`Request failed: ${errorMessage}`)
        updateResult(key, { status: 'error', message: errorMessage })
        resultStatusLog[key] = 'error'
        logClientDiagnostics('error', 'diagnostics:test:error', {
          test: key,
          error:
            e instanceof Error
              ? { name: e.name, message: e.message, stack: e.stack }
              : { message: 'Unknown error', value: e },
          detail: errorMessage,
        })
      }
    }

    logClientDiagnostics('log', 'diagnostics:foxes:fetch:start', {
      request: { path: '/api/diagnostics/foxes', method: 'GET' },
    })

    try {
      const foxRes = await fetch('/api/diagnostics/foxes')
      logClientDiagnostics('log', 'diagnostics:foxes:fetch:response', {
        response: { status: foxRes.status, ok: foxRes.ok },
      })
      if (foxRes.ok) {
        const data = await foxRes.json()
        if (data && Array.isArray(data.foxes)) {
          setFoxes(data.foxes as FoxRecord[])
          if (data.foxes.length) {
            append(`Foxes flagged: ${data.foxes.length}`)
            append(JSON.stringify(data.foxes, null, 2))
            logClientDiagnostics('log', 'diagnostics:foxes:fetch:success', {
              count: data.foxes.length,
            })
          } else {
            append('Foxes flagged: 0')
            logClientDiagnostics('log', 'diagnostics:foxes:fetch:success', {
              count: 0,
            })
          }
        }
      }
    } catch (err) {
      append('Failed to load fox diagnostics.')
      logClientDiagnostics('error', 'diagnostics:foxes:fetch:error', {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { message: 'Unknown error', value: err },
      })
    }

    append('Diagnostics complete.')
    logClientDiagnostics('log', 'diagnostics:run:complete', {
      testsRun: TEST_ORDER.length,
      results: { ...resultStatusLog },
    })
    setIsRunning(false)
  }

  const transcriptTurnLabel =
    latestTranscript && typeof latestTranscript.turn === 'number' && latestTranscript.turn > 0
      ? latestTranscript.turn
      : '–'
  const transcriptTimestampLabel =
    latestTranscript && typeof latestTranscript.at === 'string' && latestTranscript.at.length
      ? Number.isNaN(Date.parse(latestTranscript.at))
        ? 'time unknown'
        : new Date(latestTranscript.at).toLocaleString()
      : 'time unknown'
  const transcriptReasonLabel = latestTranscript?.reason
    ? ` (${String(latestTranscript.reason).replace(/_/g, ' ')})`
    : ''
  const transcriptProviderLabel = latestTranscript?.provider
    ? latestTranscript.provider
    : 'provider unknown'

  return (
    <main>
      <div className="panel-card diagnostics-panel">
        <h2 className="page-heading">Diagnostics</h2>
        <button onClick={runDiagnostics} disabled={isRunning} className="btn-secondary btn-large">
          {isRunning ? 'Running…' : 'Run full diagnostics'}
        </button>

        <div className="diagnostics-transcript">
          <h3>Latest transcript heard</h3>
          {latestTranscript ? (
            <div className="diagnostic-card">
              <div className="diagnostic-card-head">
                <span className="diagnostic-label">
                  Turn {transcriptTurnLabel} · {transcriptTimestampLabel} · {transcriptProviderLabel}
                </span>
              </div>
              <div className="diagnostic-message">
                {latestTranscript.isEmpty
                  ? `No transcript captured${transcriptReasonLabel}.`
                  : `“${latestTranscript.text}”`}
              </div>
              {latestTranscript.meta && (
                <div className="diagnostic-meta">
                  Started: {formatFlag(latestTranscript.meta.started)} · Manual stop:{' '}
                  {formatFlag(latestTranscript.meta.manualStop)} · Stop reason:{' '}
                  {latestTranscript.meta.stopReason || 'unknown'}
                </div>
              )}
            </div>
          ) : (
            <p className="status-note">No recent transcript data captured yet.</p>
          )}
        </div>

        <div className="diagnostics-provider-error">
          <h3>Latest provider error</h3>
          {latestProviderError ? (
            <div className="diagnostic-card">
              <div className="diagnostic-card-head">
                <span className="diagnostic-label">
                  {latestProviderError.status ? `HTTP ${latestProviderError.status}` : 'Request failed'} ·{' '}
                  {Number.isNaN(Date.parse(latestProviderError.at))
                    ? 'time unknown'
                    : new Date(latestProviderError.at).toLocaleString()}
                </span>
              </div>
              <div className="diagnostic-message">{latestProviderError.message}</div>
              <div className="diagnostic-meta">
                Reason: {latestProviderError.reason || 'unspecified'} · Status:{' '}
                {latestProviderError.resolved ? 'resolved' : 'active'}
                {latestProviderError.resolved && latestProviderError.resolvedAt
                  ? ` at ${new Date(latestProviderError.resolvedAt).toLocaleString()}`
                  : ''}
              </div>
              {latestProviderError.snippet && (
                <pre className="diagnostic-snippet">{latestProviderError.snippet}</pre>
              )}
            </div>
          ) : (
            <p className="status-note">No provider errors have been recorded yet.</p>
          )}
        </div>

        <div className="diagnostics-env-dump">
          <h3>Environment variables snapshot</h3>
          {envError ? (
            <p className="status-note env-error-note">
              Failed to load environment variables: {envError}
            </p>
          ) : envDump === null ? (
            <p className="status-note">Loading environment variables…</p>
          ) : envDump.length === 0 ? (
            <p className="status-note">No environment variables were returned by diagnostics.</p>
          ) : (
            <>
              {envSummary && (
                <div className="diagnostics-env-summary">
                  <span>Total: {envSummary.total}</span>
                  <span>Errors: {envSummary.errors}</span>
                  <span>Warnings: {envSummary.warnings}</span>
                </div>
              )}
              <div className="env-table-wrapper" role="region" aria-live="polite">
                <table className="env-table">
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Status</th>
                      <th scope="col">Value</th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envDump.map((entry, index) => {
                      const rowKey = entry.key && entry.key.length ? entry.key : `env-${index}`
                      return (
                        <tr key={rowKey}>
                          <td>{entry.key || '(unnamed)'}</td>
                          <td>
                            <span className={`env-severity env-${entry.severity}`}>
                              {entry.severity.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <code>{entry.value ?? '(undefined)'}</code>
                          </td>
                          <td>{entry.message ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="diagnostics-tests">
          {TEST_ORDER.map((key) => {
            const result = results[key]
            return (
              <div key={key} className="diagnostic-card">
                <div className="diagnostic-card-head">
                  <span className="diagnostic-icon" aria-hidden="true">
                    {statusIcon[result.status]}
                  </span>
                  <span className="diagnostic-label">{TEST_CONFIG[key].label}</span>
                </div>
                {result.message && <div className="diagnostic-message">{result.message}</div>}
              </div>
            )
          })}
        </div>

        <textarea value={log} readOnly rows={12} className="diagnostics-log" />

        <div className="diagnostics-foxes">
          <h3>Tracked foxes</h3>
          {foxes.length === 0 ? (
            <p className="status-note">No foxes have been triggered yet.</p>
          ) : (
            <ul className="diagnostics-fox-list">
              {foxes.map((fox) => (
                <li key={fox.id} className="diagnostic-card">
                  <div className="fox-head">
                    <span className="fox-title">Theory {fox.theory} – {fox.message}</span>
                    <span className="fox-level">{fox.level}</span>
                  </div>
                  <div className="fox-meta">
                    Count: {fox.count} · Last: {new Date(fox.lastTriggeredAt).toLocaleString()}
                  </div>
                  {fox.details && (
                    <pre className="fox-details">{JSON.stringify(fox.details, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
