import { URL } from 'node:url'
import type { DeploymentMetadata, ParsedRepo } from '@/types/deployment'
export type { DeploymentMetadata } from '@/types/deployment'

type LogLevel = 'log' | 'error'

type LogPayload = Record<string, unknown>

type DeployIdCandidate = {
  key: string
  value: string | undefined
}

const HYPOTHESES = [
  'Vercel preview builds may omit VERCEL_DEPLOYMENT_ID if the project environment variables are not exposed to the build.',
  'Legacy Netlify variables could linger in the environment and confuse downstream diagnostics during the platform migration.',
  'Client diagnostics will fail to hydrate if the bootstrap script stops publishing refreshed deployment metadata.',
]

function formatTimestamp() {
  return new Date().toISOString()
}

function envSummary() {
  return {
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    totalKeys: Object.keys(process.env).length,
  }
}

function log(level: LogLevel, step: string, payload: LogPayload = {}) {
  const entry = { ...payload, envSummary: envSummary(), hypotheses: HYPOTHESES }
  const message = `[diagnostic] ${formatTimestamp()} deployment-metadata:${step} ${JSON.stringify(entry)}`
  if (level === 'error') {
    console.error(message)
  } else {
    console.log(message)
  }
}

function parseRepoFromEnv(): ParsedRepo {
  const vercelOwner = process.env.VERCEL_GIT_REPO_OWNER ?? null
  const vercelSlug = process.env.VERCEL_GIT_REPO_SLUG ?? null
  if (vercelOwner && vercelSlug) {
    return {
      owner: vercelOwner,
      name: vercelSlug,
      httpsUrl: `https://github.com/${vercelOwner}/${vercelSlug}`,
    }
  }

  const fromGithub = process.env.GITHUB_REPOSITORY ?? process.env.NEXT_PUBLIC_GITHUB_REPOSITORY ?? null
  if (fromGithub && fromGithub.includes('/')) {
    const [owner, name] = fromGithub.split('/', 2)
    return {
      owner,
      name,
      httpsUrl: `https://github.com/${owner}/${name}`,
    }
  }

  const repositoryUrl = process.env.REPOSITORY_URL ?? null
  if (repositoryUrl) {
    try {
      const parsed = new URL(repositoryUrl)
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const owner = parts[parts.length - 2]
        const name = parts[parts.length - 1].replace(/\.git$/i, '')
        return {
          owner,
          name,
          httpsUrl: `https://github.com/${owner}/${name}`,
        }
      }
    } catch (error) {
      log('error', 'repo:parse-error', { repositoryUrl, error })
    }
  }

  return {
    owner: null,
    name: null,
    httpsUrl: null,
  }
}

function pickDeployId(): { candidate: DeployIdCandidate | null; cleanedValue: string | null } {
  const candidates: DeployIdCandidate[] = [
    { key: 'VERCEL_DEPLOYMENT_ID', value: process.env.VERCEL_DEPLOYMENT_ID },
    { key: 'DEPLOY_ID', value: process.env.DEPLOY_ID },
    { key: 'NEXT_PUBLIC_DEPLOY_ID', value: process.env.NEXT_PUBLIC_DEPLOY_ID },
  ]

  for (const candidate of candidates) {
    if (typeof candidate.value === 'string') {
      const trimmed = candidate.value.trim()
      if (trimmed.length > 0) {
        return { candidate, cleanedValue: trimmed }
      }
    }
  }

  return { candidate: null, cleanedValue: null }
}

function buildFallbackDeployId(): { value: string; source: string } {
  const fallback = `local-dev-${Date.now().toString(36)}`
  log('log', 'resolve:deploy-id:fallback', { fallback, hypotheses: HYPOTHESES })
  return { value: fallback, source: 'fallback:local-dev' }
}

function normalizeUrl(raw: string | null, label: string): string | null {
  if (!raw) {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  const candidate = /^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    return parsed.toString()
  } catch (error) {
    log('error', 'url:parse-error', { label, raw, error })
    return null
  }
}

export function resolveDeploymentMetadata(): DeploymentMetadata {
  log('log', 'resolve:start', {})

  const { candidate, cleanedValue } = pickDeployId()
  const { value: deployId, source: deployIdSource } = cleanedValue && candidate
    ? { value: cleanedValue, source: candidate.key }
    : buildFallbackDeployId()

  const commitRef =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    null
  const commitMessage =
    process.env.VERCEL_GIT_COMMIT_MESSAGE ??
    process.env.GIT_COMMIT_MESSAGE ??
    process.env.COMMIT_MESSAGE ??
    null
  const commitTimestamp = process.env.COMMIT_TIMESTAMP ?? process.env.GIT_COMMIT_TIMESTAMP ?? null
  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ??
    process.env.GIT_COMMIT_REF ??
    process.env.BRANCH ??
    process.env.HEAD ??
    null
  const projectId = process.env.VERCEL_PROJECT_ID ?? null
  const projectName = process.env.VERCEL_PROJECT_NAME ?? null
  const orgId = process.env.VERCEL_ORG_ID ?? null
  const deployUrl =
    normalizeUrl(process.env.VERCEL_URL ?? process.env.DEPLOY_URL ?? null, 'deployUrl') ?? null
  const previewUrl =
    normalizeUrl(process.env.VERCEL_BRANCH_URL ?? process.env.DEPLOY_PRIME_URL ?? null, 'previewUrl') ?? null
  const siteUrl =
    normalizeUrl(
      process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.URL ?? process.env.SITE_URL ?? null,
      'siteUrl',
    ) ?? null
  const context = process.env.VERCEL_ENV ?? process.env.CONTEXT ?? null
  const region = process.env.VERCEL_REGION ?? null

  const repo = parseRepoFromEnv()

  const metadata: DeploymentMetadata = {
    platform: process.env.VERCEL ? 'vercel' : 'custom',
    deployId,
    deployIdSource,
    commitRef,
    commitMessage,
    commitTimestamp,
    branch,
    projectId,
    projectName,
    orgId,
    deployUrl,
    previewUrl,
    siteUrl,
    repo,
    context,
    region,
  }

  log('log', 'resolve:success', { metadata })

  return metadata
}

export function buildDeploymentBootstrapScript(metadata: DeploymentMetadata): string {
  log('log', 'bootstrap:emit', { metadataPreview: { ...metadata, repo: metadata.repo } })

  const literal = JSON.stringify(metadata)
  return `(() => {\n  const step = 'deployment:bootstrap:apply'\n  const now = new Date().toISOString()\n  const summary = typeof window === 'undefined'\n    ? { origin: '__no_window__', pathname: '__no_window__' }\n    : { origin: window.location.origin, pathname: window.location.pathname }\n  const payload = { metadata: ${literal}, summary }\n  console.log('[diagnostic] ' + now + ' ' + step + ' ' + JSON.stringify(payload))\n  window.__DEPLOYMENT_METADATA__ = ${literal}\n  window.dispatchEvent(new CustomEvent('deployment:ready', { detail: ${literal} }))\n})()`
}
