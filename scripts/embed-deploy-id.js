#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function timestamp() {
  return new Date().toISOString()
}

function envSnapshot() {
  return {
    NETLIFY: process.env.NETLIFY ?? null,
    DEPLOY_ID: process.env.DEPLOY_ID ?? null,
    MY_DEPLOY_ID: process.env.MY_DEPLOY_ID ?? null,
    NODE_VERSION: process.version,
  }
}

function log(level, step, payload = {}) {
  const messagePayload = { step, ...payload, env: envSnapshot() }
  const prefix = `[diagnostic] ${timestamp()} embed-deploy-id ${step}`
  if (level === 'error') {
    console.error(`${prefix} ${JSON.stringify(messagePayload)}`)
  } else {
    console.log(`${prefix} ${JSON.stringify(messagePayload)}`)
  }
}

log('log', 'start', {
  note: 'Embedding Netlify deploy identifier before build.',
  cwd: process.cwd(),
})

const deployId = typeof process.env.DEPLOY_ID === 'string' ? process.env.DEPLOY_ID.trim() : ''
if (!deployId) {
  log('error', 'missing-deploy-id', {
    note: 'DEPLOY_ID must be provided by Netlify at build time. Aborting to avoid broken runtime.',
  })
  process.exit(1)
}

const outputDir = path.join(process.cwd(), '.next')
const outputFile = path.join(outputDir, 'deploy-id.json')

try {
  fs.mkdirSync(outputDir, { recursive: true })
  log('log', 'directory-ensured', {
    directory: outputDir,
  })

  const payload = { deployID: deployId }
  fs.writeFileSync(outputFile, `${JSON.stringify(payload)}\n`, 'utf8')
  log('log', 'deploy-id-written', {
    file: outputFile,
    deployIdPreview: deployId.length > 8 ? `${deployId.slice(0, 4)}…${deployId.slice(-4)}` : deployId,
  })

  log('log', 'complete', {
    note: 'Successfully embedded deploy ID for runtime use.',
  })
} catch (error) {
  log('error', 'write-failed', {
    file: outputFile,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
  })
  process.exit(1)
}
