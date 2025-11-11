const { env } = process

const relevantEnvSummary = () => ({
  NETLIFY: env.NETLIFY ?? null,
  DEPLOY_ID: env.DEPLOY_ID ?? null,
  NETLIFY_DEPLOY_ID: env.NETLIFY_DEPLOY_ID ?? null,
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

if (env.NETLIFY) {
  diagnosticLog('Netlify runtime detected, verifying deploy identifiers')

  if (!env.DEPLOY_ID && env.NETLIFY_DEPLOY_ID) {
    diagnosticLog('Hydrating DEPLOY_ID from NETLIFY_DEPLOY_ID', {
      netlifyDeployId: env.NETLIFY_DEPLOY_ID,
    })
    env.DEPLOY_ID = env.NETLIFY_DEPLOY_ID
  }

  if (!env.DEPLOY_ID) {
    diagnosticThrow(
      'Required Netlify deployment identifiers are missing. Ensure NETLIFY_DEPLOY_ID is available before building.',
    )
  }
} else {
  diagnosticLog('Non-Netlify runtime detected; skipping Option B deploy identifier patch')
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
}

module.exports = nextConfig
