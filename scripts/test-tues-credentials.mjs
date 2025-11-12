#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function timestamp() {
  return new Date().toISOString()
}

function envSnapshot() {
  return {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null,
  }
}

function logInfo(message, details) {
  const payload = { level: 'info', message, details: details ?? null, env: envSnapshot() }
  console.log(`[diagnostic] ${timestamp()} ${JSON.stringify(payload)}`)
}

function logError(message, details) {
  const payload = { level: 'error', message, details: details ?? null, env: envSnapshot() }
  console.error(`[diagnostic] ${timestamp()} ${JSON.stringify(payload)}`)
}

function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument format: ${arg}`)
    }
    const [key, value] = arg.slice(2).split('=')
    if (!key || typeof value === 'undefined') {
      throw new Error(`Missing value for option "${arg}"`)
    }
    options[key] = value
  }
  return options
}

function ensurePresent(value, label) {
  if (!value || value.trim() === '') {
    throw new Error(`${label} is required and was not provided`)
  }
  if (/replace|example|changeme|default/i.test(value)) {
    throw new Error(`${label} is using a placeholder value (${value}). Please provide the real credential before running this diagnostic.`)
  }
  return value
}

function runCurl(args, description, maskRules = []) {
  logInfo(`Executing curl for ${description}`, `(args: ${maskCurlArgs(args, maskRules).join(' ')})`)
  const result = spawnSync('curl', args, { encoding: 'utf8' })
  if (result.error) {
    throw new Error(`${description} curl execution failed: ${result.error.message}`)
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${description} curl exited with status ${result.status}. stderr: ${result.stderr || 'n/a'}`)
  }
  if (result.stderr) {
    logInfo(`${description} stderr`, result.stderr.trim())
  }
  logInfo(`${description} raw response`, result.stdout.trim() || '[empty]')
  return result.stdout
}

function maskCurlArgs(args, maskRules) {
  if (!maskRules.length) return args
  return args.map((value) => {
    for (const rule of maskRules) {
      if (typeof value === 'string' && value.includes(rule.match)) {
        return value.replace(rule.match, rule.replacement)
      }
    }
    return value
  })
}

function main() {
  try {
    logInfo('Starting TUES credential diagnostic', `(argv count: ${process.argv.length - 2})`)
    const options = parseArgs(process.argv.slice(2))

    const authUrl = ensurePresent(options['auth-url'], 'auth-url')
    const grantType = ensurePresent(options['grant-type'], 'grant-type')
    const clientId = ensurePresent(options['client-id'], 'client-id')
    const clientSecret = ensurePresent(options['client-secret'], 'client-secret')
    const verifyUrl = ensurePresent(options['verify-url'], 'verify-url')
    const verifyMethod = ensurePresent(options['verify-method'], 'verify-method').toUpperCase()
    const expectedStatus = Number.parseInt(ensurePresent(options['expected-status'], 'expected-status'), 10)

    if (!Number.isFinite(expectedStatus)) {
      throw new Error(`expected-status must be a valid number. Received: ${options['expected-status']}`)
    }

    const scope = options.scope ? ensurePresent(options.scope, 'scope') : null
    const audience = options.audience ? ensurePresent(options.audience, 'audience') : null

    logInfo('Collected configuration', JSON.stringify({
      authUrl,
      grantType,
      clientIdPreview: clientId.length > 6 ? `${clientId.slice(0, 3)}…${clientId.slice(-3)}` : clientId,
      scopeProvided: !!scope,
      audienceProvided: !!audience,
      verifyUrl,
      verifyMethod,
      expectedStatus,
    }))

    const tokenCurlArgs = ['-sS', '-X', options['auth-method'] ? ensurePresent(options['auth-method'], 'auth-method').toUpperCase() : 'POST', authUrl, '-H', 'Content-Type: application/x-www-form-urlencoded', '--data-urlencode', `grant_type=${grantType}`, '--data-urlencode', `client_id=${clientId}`, '--data-urlencode', `client_secret=${clientSecret}`]

    const maskRules = [{ match: clientSecret, replacement: '***redacted***' }]
    if (scope) {
      tokenCurlArgs.push('--data-urlencode', `scope=${scope}`)
    }
    if (audience) {
      tokenCurlArgs.push('--data-urlencode', `audience=${audience}`)
    }

    const tokenResponse = runCurl(tokenCurlArgs, 'token request', maskRules)

    let tokenPayload
    try {
      tokenPayload = JSON.parse(tokenResponse)
    } catch (error) {
      throw new Error(`Token endpoint did not return JSON. ${(error && error.message) || 'Unknown parse error'}`)
    }

    const accessToken = ensurePresent(tokenPayload.access_token, 'tokenPayload.access_token')
    const tokenType = ensurePresent(tokenPayload.token_type, 'tokenPayload.token_type')

    logInfo('Token payload parsed', JSON.stringify({ tokenType, expiresIn: tokenPayload.expires_in, scope: tokenPayload.scope }))

    const verifyCurlArgs = ['-sS', '-X', verifyMethod, verifyUrl, '-H', `Authorization: ${tokenType} ${accessToken}`]
    if (options['verify-header']) {
      const headerPairs = options['verify-header'].split(';').filter(Boolean)
      for (const pair of headerPairs) {
        const [name, value] = pair.split(':')
        if (!name || !value) {
          throw new Error(`Invalid verify-header entry: ${pair}. Expected format name:value`)
        }
        verifyCurlArgs.push('-H', `${name.trim()}: ${value.trim()}`)
      }
    }

    const verifyBody = options['verify-body'] ? ensurePresent(options['verify-body'], 'verify-body') : null
    if (verifyBody) {
      verifyCurlArgs.push('-d', verifyBody)
    }

    const verifyResponse = runCurl(verifyCurlArgs, 'verification request', [{ match: accessToken, replacement: '***redacted***' }])

    const statusArgs = ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-X', verifyMethod, verifyUrl, '-H', `Authorization: ${tokenType} ${accessToken}`]
    if (options['verify-header']) {
      const headerPairs = options['verify-header'].split(';').filter(Boolean)
      for (const pair of headerPairs) {
        const [name, value] = pair.split(':')
        statusArgs.push('-H', `${name.trim()}: ${value.trim()}`)
      }
    }
    if (verifyBody) {
      statusArgs.push('-d', verifyBody)
    }
    logInfo('Checking verification HTTP status code')
    const statusResult = spawnSync('curl', statusArgs, { encoding: 'utf8' })
    if (statusResult.error) {
      throw new Error(`Verification status curl failed: ${statusResult.error.message}`)
    }
    if (typeof statusResult.status === 'number' && statusResult.status !== 0) {
      throw new Error(`Verification status curl exited with ${statusResult.status}. stderr: ${statusResult.stderr || 'n/a'}`)
    }
    const httpStatus = Number.parseInt(statusResult.stdout.trim(), 10)
    logInfo('Verification status observed', httpStatus.toString())

    if (httpStatus !== expectedStatus) {
      throw new Error(`Verification endpoint returned status ${httpStatus}, expected ${expectedStatus}`)
    }

    logInfo('TUES credential diagnostic completed successfully')
  } catch (error) {
    logError('TUES credential diagnostic failed', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
