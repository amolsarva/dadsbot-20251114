const { env } = process

const relevantEnvSummary = () => ({
  NETLIFY: env.NETLIFY ?? null,
  DEPLOY_ID: env.DEPLOY_ID ?? null,
  MY_DEPLOY_ID: env.MY_DEPLOY_ID ?? null,
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
  diagnosticLog('Netlify runtime detected, validating deploy identifiers before applying Option B patch')

  if (!env.DEPLOY_ID) {
    diagnosticThrow('Required Netlify environment variable DEPLOY_ID is missing; cannot safely continue with deploy rehydration')
  }

  if (!env.MY_DEPLOY_ID) {
    diagnosticThrow('Required override environment variable MY_DEPLOY_ID is missing; set it explicitly to opt in to the deploy rehydration patch')
  }

  if (env.MY_DEPLOY_ID !== env.DEPLOY_ID) {
    diagnosticLog('Applying Option B deploy rehydration by syncing DEPLOY_ID from MY_DEPLOY_ID', {
      previousDeployId: env.DEPLOY_ID,
      overrideDeployId: env.MY_DEPLOY_ID,
    })
    env.DEPLOY_ID = env.MY_DEPLOY_ID
    diagnosticLog('Option B deploy rehydration complete; DEPLOY_ID now matches override value')
  } else {
    diagnosticLog('DEPLOY_ID already matches MY_DEPLOY_ID; no Option B patch necessary')
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
