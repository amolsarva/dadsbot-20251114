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
  'Local builds may rely on a generated deploy identifier when Vercel metadata is absent.',
  'Commit metadata could still reference deprecated hosting variables, breaking build footer links.',
  'Client diagnostics may not receive deployment context if no bootstrap script publishes it.',
]

function formatTimestamp() {
  return new Date().toISOString()
}

function envSummary() {
  return {
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
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
    { key: 'VERCEL_GIT_COMMIT_SHA', value: process.env.VERCEL_GIT_COMMIT_SHA },
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

export function resolveDeploymentMetadata(): DeploymentMetadata {
  log('log', 'resolve:start', {})

  const { candidate, cleanedValue } = pickDeployId()
  const { value: deployId, source: deployIdSource } = cleanedValue && candidate
    ? { value: cleanedValue, source: candidate.key }
    : buildFallbackDeployId()

  const commitRef =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF ?? process.env.GIT_COMMIT_SHA ?? null
  const commitMessage =
    process.env.VERCEL_GIT_COMMIT_MESSAGE ?? process.env.COMMIT_MESSAGE ?? process.env.GIT_COMMIT_MESSAGE ?? null
  const commitTimestamp =
    process.env.VERCEL_GIT_COMMIT_TIMESTAMP ??
    process.env.COMMIT_TIMESTAMP ??
    process.env.GIT_COMMIT_TIMESTAMP ??
    null
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.BRANCH ?? process.env.HEAD ?? null
  const projectId = process.env.VERCEL_PROJECT_ID ?? null
  const orgId = process.env.VERCEL_ORG_ID ?? null
  const branchUrl = process.env.VERCEL_BRANCH_URL ?? null
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null
  const deployUrl = branchUrl ?? vercelUrl ?? null
  const siteUrl = vercelUrl ?? process.env.SITE_URL ?? null
  const environment = process.env.VERCEL_ENV ?? null

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
    orgId,
    deployUrl,
    siteUrl,
    repo,
    environment,
  }

  log('log', 'resolve:success', { metadata })

  return metadata
}

export function buildDeploymentBootstrapScript(metadata: DeploymentMetadata): string {
  log('log', 'bootstrap:emit', { metadataPreview: { ...metadata, repo: metadata.repo } })

  const literal = JSON.stringify(metadata)
  return `(() => {\n  const step = 'deployment:bootstrap:apply'\n  const now = new Date().toISOString()\n  const summary = typeof window === 'undefined'\n    ? { origin: '__no_window__', pathname: '__no_window__' }\n    : { origin: window.location.origin, pathname: window.location.pathname }\n  const payload = { metadata: ${literal}, summary }\n  console.log('[diagnostic] ' + now + ' ' + step + ' ' + JSON.stringify(payload))\n  window.__DEPLOYMENT_METADATA__ = ${literal}\n  window.dispatchEvent(new CustomEvent('deployment:ready', { detail: ${literal} }))\n})()`
}
