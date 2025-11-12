import { resolveDeploymentMetadata } from '@/lib/deployment-metadata.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const formatTimestamp = () => new Date().toISOString()

const envSummary = () => ({
  totalKeys: Object.keys(process.env).length,
  nodeEnv: process.env.NODE_ENV ?? null,
  platform: process.env.VERCEL ? 'vercel' : 'custom',
  vercelEnv: process.env.VERCEL_ENV ?? null,
})

const logStep = (step: string, payload?: Record<string, unknown>) => {
  const summary = envSummary()
  const merged = { ...payload, envSummary: summary }
  console.log(`[diagnostic] ${formatTimestamp()} ${step} ${JSON.stringify(merged)}`)
}

const logError = (step: string, error: unknown, payload?: Record<string, unknown>) => {
  const summary = envSummary()
  const normalizedError =
    error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: 'Non-error rejection', value: error }
  const merged = { ...payload, envSummary: summary, error: normalizedError }
  console.error(`[diagnostic] ${formatTimestamp()} ${step} ${JSON.stringify(merged)}`)
}

const HYPOTHESES = [
  'Deploy ID variables were not exported into the runtime environment.',
  'Deployment metadata helper is not wired to diagnostics route.',
  'Vercel deployment metadata is incomplete so blobs cannot attribute writes correctly.',
]

export async function GET() {
  const stepBase = 'diagnostics.deploy.get'
  try {
    logStep(`${stepBase}:start`, { hypotheses: HYPOTHESES })

    const metadata = resolveDeploymentMetadata()
    const responsePayload = {
      deployId: metadata.deployId,
      deployIdSource: metadata.deployIdSource,
      environment: metadata.environment,
      projectId: metadata.projectId,
      orgId: metadata.orgId,
      deployUrl: metadata.deployUrl,
      branch: metadata.branch,
      commitRef: metadata.commitRef,
      repo: metadata.repo,
      hypotheses: HYPOTHESES,
    }

    logStep(`${stepBase}:resolved`, responsePayload)

    return Response.json(responsePayload)
  } catch (error) {
    logError(`${stepBase}:error`, error)
    throw error instanceof Error
      ? new Error(`[diagnostic] deploy inspection failed: ${error.message}`)
      : new Error('[diagnostic] deploy inspection failed: non-error rejection')
  }
}
