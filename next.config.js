const { env } = process

const relevantEnvSummary = () => ({
  VERCEL: env.VERCEL ?? null,
  VERCEL_ENV: env.VERCEL_ENV ?? null,
  VERCEL_DEPLOYMENT_ID: env.VERCEL_DEPLOYMENT_ID ?? null,
  DEPLOY_ID: env.DEPLOY_ID ?? null,
})

const diagnosticLog = (message, extra = {}) => {
  const timestamp = new Date().toISOString()
  const payload = { ...extra, envSummary: relevantEnvSummary() }
  console.log(`[diagnostic] ${timestamp} | ${message} | payload=${JSON.stringify(payload)}`)
}

const diagnosticThrow = (message, extra = {}) => {
  const timestamp = new Date().toISOString()
  const payload = { ...extra, envSummary: relevantEnvSummary() }
  const serializedPayload = JSON.stringify(payload)
  const formattedMessage = `[diagnostic] ${timestamp} | ${message} | payload=${serializedPayload}`
  console.error(formattedMessage)
  throw new Error(formattedMessage)
}

if (env.VERCEL) {
  diagnosticLog('Vercel runtime detected, verifying deploy identifiers')

  if (!env.DEPLOY_ID && env.VERCEL_DEPLOYMENT_ID) {
    diagnosticLog('Hydrating DEPLOY_ID from VERCEL_DEPLOYMENT_ID', {
      vercelDeploymentId: env.VERCEL_DEPLOYMENT_ID,
    })
    env.DEPLOY_ID = env.VERCEL_DEPLOYMENT_ID
  }

  if (!env.DEPLOY_ID) {
    diagnosticThrow(
      'Required Vercel deployment identifiers are missing. Ensure VERCEL_DEPLOYMENT_ID is available before building.',
    )
  }
} else {
  diagnosticLog('Custom runtime detected; verifying explicit DEPLOY_ID override')
  if (!env.DEPLOY_ID) {
    diagnosticThrow('DEPLOY_ID must be provided for non-Vercel builds to keep diagnostics consistent.')
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
}

module.exports = nextConfig
