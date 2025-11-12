import { resolveDeploymentMetadata } from '@/lib/deployment-metadata.server'
import { NextResponse } from 'next/server'
import { jsonErrorResponse } from '@/lib/api-error'

type EndpointSummary = {
  key: string
  method: 'GET' | 'POST'
  path: string
  description: string
}

const ENDPOINTS: EndpointSummary[] = [
  {
    key: 'health',
    method: 'GET',
    path: '/api/health',
    description: 'Overall service health, storage configuration, and email defaults.',
  },
  {
    key: 'env',
    method: 'GET',
    path: '/api/diagnostics/env',
    description: 'Full environment inspection and validation for required variables.',
  },
  {
    key: 'storage',
    method: 'GET',
    path: '/api/diagnostics/storage',
    description: 'Blob store readiness check and environment diagnostics.',
  },
  {
    key: 'google',
    method: 'GET',
    path: '/api/diagnostics/google',
    description: 'Connectivity test against the configured Google AI model.',
  },
  {
    key: 'openai',
    method: 'GET',
    path: '/api/diagnostics/openai',
    description: 'Connectivity test against the configured OpenAI model.',
  },
  {
    key: 'tues',
    method: 'POST',
    path: '/api/diagnostics/tues',
    description: 'Vercel-hosted credential diagnostic that mirrors the curl workflow for TUES.',
  },
  {
    key: 'smoke',
    method: 'POST',
    path: '/api/diagnostics/smoke',
    description: 'End-to-end session smoke test that writes to the configured blob store.',
  },
  {
    key: 'e2e',
    method: 'POST',
    path: '/api/diagnostics/e2e',
    description: 'Full workflow exercise that mirrors production transcript storage.',
  },
  {
    key: 'email',
    method: 'POST',
    path: '/api/diagnostics/email',
    description: 'Dispatches a summary email via the configured provider.',
  },
]

function detectDeployment() {
  const metadata = resolveDeploymentMetadata()
  const platform = metadata.platform

  return {
    platform,
    functionBase: null as string | null,
    nodeEnv: process.env.NODE_ENV,
    edgeMiddleware: Boolean(process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs'),
    vercelProjectId: metadata.projectId ?? null,
    vercelProjectName: metadata.projectName ?? null,
    vercelOrgId: metadata.orgId ?? null,
    deployContext: metadata.context ?? null,
    deployUrl: metadata.deployUrl ?? metadata.previewUrl ?? metadata.siteUrl ?? null,
    previewUrl: metadata.previewUrl ?? null,
    siteUrl: metadata.siteUrl ?? null,
    deployId: metadata.deployId,
    branch: metadata.branch,
    commitRef: metadata.commitRef,
    region: metadata.region ?? null,
  }
}

const TROUBLESHOOTING = [
  'If this endpoint returns 404 in production, ensure the Vercel deployment exposes the Next.js app directory routes.',
  'Confirm the project is configured with `output: "standalone"` so server functions remain routable on Vercel.',
  'When custom timeouts or memory are required, declare the diagnostics routes inside `vercel.json` under `functions`.',
  'Inspect recent Vercel build logs for pruning messages if the diagnostics handlers fail to compile.',
]

export async function GET() {
  try {
    const deployment = detectDeployment()

    const preferredBase = deployment.functionBase ? `${deployment.functionBase}/diagnostics` : '/api/diagnostics'

    return NextResponse.json({
      ok: true,
      message:
        'Diagnostics base route is available. Invoke the specific endpoints below to run targeted checks.',
      preferredBase,
      deployment,
      endpoints: ENDPOINTS,
      troubleshooting: TROUBLESHOOTING,
    })
  } catch (error) {
    return jsonErrorResponse(error, 'Failed to load diagnostics metadata')
  }
}
