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
  diagnosticLog('Vercel runtime detected, verifying deployment identifiers')

  if (!env.VERCEL_DEPLOYMENT_ID && env.DEPLOY_ID) {
    diagnosticLog('Using legacy DEPLOY_ID in absence of VERCEL_DEPLOYMENT_ID', {
      deployId: env.DEPLOY_ID,
    })
  }

  if (!env.VERCEL_DEPLOYMENT_ID && !env.DEPLOY_ID) {
    diagnosticThrow(
      'Vercel deployment identifier missing. Ensure VERCEL_DEPLOYMENT_ID is available before building.',
    )
  }
} else {
  diagnosticLog('Non-Vercel runtime detected; ensure local secrets are configured explicitly')
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
}

module.exports = nextConfig
