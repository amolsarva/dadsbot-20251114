import { NextResponse } from 'next/server'

import { jsonErrorResponse } from '@/lib/api-error'

export const runtime = 'nodejs'

const PLACEHOLDER_PATTERN = /(example|replace|changeme|default|sample|todo)/i

type Stage =
  | 'init'
  | 'collect-env'
  | 'token-request'
  | 'token-parse'
  | 'verify-request'
  | 'complete'

const REQUIRED_KEYS = [
  'TUES_AUTH_URL',
  'TUES_GRANT_TYPE',
  'TUES_CLIENT_ID',
  'TUES_CLIENT_SECRET',
  'TUES_VERIFY_URL',
  'TUES_VERIFY_METHOD',
  'TUES_EXPECTED_STATUS',
] as const

type RequiredKey = (typeof REQUIRED_KEYS)[number]

type OptionalKey =
  | 'TUES_SCOPE'
  | 'TUES_AUDIENCE'
  | 'TUES_VERIFY_HEADERS'
  | 'TUES_VERIFY_BODY'
  | 'TUES_AUTH_METHOD'

function timestamp(): string {
  return new Date().toISOString()
}

function envSnapshot() {
  return {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? null,
  }
}

function logInfo(message: string, details?: Record<string, unknown>) {
  const payload = { stage: details?.stage, message, details, env: envSnapshot() }
  console.log(`[diagnostic] ${timestamp()} ${JSON.stringify(payload)}`)
}

function logError(message: string, details?: Record<string, unknown>) {
  const payload = { stage: details?.stage, message, details, env: envSnapshot() }
  console.error(`[diagnostic] ${timestamp()} ${JSON.stringify(payload)}`)
}

function ensureEnv(key: RequiredKey): string {
  const value = process.env[key]
  if (!value || !value.trim()) {
    throw new Error(`${key} is required for the TUES diagnostic and was not provided`)
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${key} is using a placeholder value (${value}). Set a real credential in Vercel (or your secrets manager) before running.`)
  }
  return value.trim()
}

function readOptionalEnv(key: OptionalKey): string | null {
  const raw = process.env[key]
  if (!raw || !raw.trim()) {
    return null
  }
  if (PLACEHOLDER_PATTERN.test(raw)) {
    throw new Error(`${key} is using a placeholder value (${raw}). Update the Vercel environment configuration.`)
  }
  return raw.trim()
}

function ensurePayloadField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} was missing from the token payload`)
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${label} looks like a placeholder (${value}). Check the identity provider response.`)
  }
  return value.trim()
}

function mask(value: string): string {
  if (value.length <= 6) return value
  return `${value.slice(0, 3)}…${value.slice(-3)}`
}

function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {}
  const headers: Record<string, string> = {}
  const pairs = raw.split(';').map((part) => part.trim()).filter(Boolean)
  for (const pair of pairs) {
    const [name, value] = pair.split(':')
    if (!name || !value) {
      throw new Error(`Invalid TUES_VERIFY_HEADERS entry: ${pair}. Use name:value;name:value format.`)
    }
    headers[name.trim()] = value.trim()
  }
  return headers
}

function buildTokenRequest(
  authUrl: string,
  authMethod: string,
  bodyParams: URLSearchParams,
): { url: string; init: RequestInit } {
  if (authMethod === 'GET') {
    const url = `${authUrl}${authUrl.includes('?') ? '&' : '?'}${bodyParams.toString()}`
    return { url, init: { method: 'GET' } }
  }
  return {
    url: authUrl,
    init: {
      method: authMethod,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    },
  }
}

export async function POST() {
  let stage: Stage = 'init'

  try {
    stage = 'collect-env'
    const envValues = REQUIRED_KEYS.reduce<Record<RequiredKey, string>>((acc, key) => {
      acc[key] = ensureEnv(key)
      return acc
    }, {} as Record<RequiredKey, string>)

    const scope = readOptionalEnv('TUES_SCOPE')
    const audience = readOptionalEnv('TUES_AUDIENCE')
    const verifyHeadersRaw = readOptionalEnv('TUES_VERIFY_HEADERS')
    const verifyBody = readOptionalEnv('TUES_VERIFY_BODY')
    const authMethod = readOptionalEnv('TUES_AUTH_METHOD')?.toUpperCase() ?? 'POST'
    const verifyMethod = ensureEnv('TUES_VERIFY_METHOD').toUpperCase()
    const expectedStatusRaw = ensureEnv('TUES_EXPECTED_STATUS')
    const expectedStatus = Number.parseInt(expectedStatusRaw, 10)

    if (!Number.isFinite(expectedStatus)) {
      throw new Error(`TUES_EXPECTED_STATUS must be a valid number. Received: ${expectedStatusRaw}`)
    }

    logInfo('Collected TUES configuration', {
      stage,
      authUrl: envValues.TUES_AUTH_URL,
      grantType: envValues.TUES_GRANT_TYPE,
      clientIdPreview: mask(envValues.TUES_CLIENT_ID),
      scopeProvided: Boolean(scope),
      audienceProvided: Boolean(audience),
      verifyUrl: envValues.TUES_VERIFY_URL,
      verifyMethod,
      expectedStatus,
      authMethod,
      customHeaders: verifyHeadersRaw ?? null,
      hasVerifyBody: Boolean(verifyBody),
    })

    const bodyParams = new URLSearchParams()
    bodyParams.set('grant_type', envValues.TUES_GRANT_TYPE)
    bodyParams.set('client_id', envValues.TUES_CLIENT_ID)
    bodyParams.set('client_secret', envValues.TUES_CLIENT_SECRET)
    if (scope) bodyParams.set('scope', scope)
    if (audience) bodyParams.set('audience', audience)

    stage = 'token-request'
    const tokenRequest = buildTokenRequest(envValues.TUES_AUTH_URL, authMethod, bodyParams)
    logInfo('Requesting access token', {
      stage,
      method: tokenRequest.init.method ?? 'POST',
      url: tokenRequest.url,
      bodyParams: authMethod === 'GET' ? '[query-string]' : bodyParams.toString(),
    })

    const tokenResponse = await fetch(tokenRequest.url, {
      ...tokenRequest.init,
      cache: 'no-store',
    })

    const rawTokenBody = await tokenResponse.text()
    logInfo('Token endpoint responded', {
      stage,
      status: tokenResponse.status,
      ok: tokenResponse.ok,
      bodySnippet: rawTokenBody.slice(0, 400) || '[empty]',
    })

    if (!tokenResponse.ok) {
      throw new Error(
        `Token endpoint returned HTTP ${tokenResponse.status}. Body snippet: ${rawTokenBody.slice(0, 200) || '[empty]'}`,
      )
    }

    stage = 'token-parse'
    let tokenPayload: Record<string, unknown>
    try {
      tokenPayload = JSON.parse(rawTokenBody)
    } catch (error) {
      throw new Error(
        `Token endpoint did not return JSON. ${(error instanceof Error && error.message) || 'Unknown parse error'}`,
      )
    }

    const accessToken = ensurePayloadField(tokenPayload.access_token, 'tokenPayload.access_token')
    const tokenType = ensurePayloadField(tokenPayload.token_type, 'tokenPayload.token_type')

    logInfo('Parsed token payload', {
      stage,
      tokenType,
      expiresIn: tokenPayload.expires_in ?? null,
      scope: tokenPayload.scope ?? null,
    })

    stage = 'verify-request'
    const verifyHeaders = {
      Authorization: `${tokenType} ${accessToken}`,
      ...parseHeaders(verifyHeadersRaw),
    }

    logInfo('Sending verification request', {
      stage,
      method: verifyMethod,
      url: envValues.TUES_VERIFY_URL,
      headerNames: Object.keys(verifyHeaders),
      hasBody: Boolean(verifyBody),
    })

    const verifyResponse = await fetch(envValues.TUES_VERIFY_URL, {
      method: verifyMethod,
      headers: verifyHeaders,
      body: verifyMethod === 'GET' ? undefined : verifyBody ?? undefined,
      cache: 'no-store',
    })

    const verifyBodyText = await verifyResponse.text()
    logInfo('Verification endpoint responded', {
      stage,
      status: verifyResponse.status,
      expectedStatus,
      ok: verifyResponse.status === expectedStatus,
      bodySnippet: verifyBodyText.slice(0, 400) || '[empty]',
    })

    if (verifyResponse.status !== expectedStatus) {
      throw new Error(
        `Verification endpoint returned HTTP ${verifyResponse.status}, expected ${expectedStatus}. Body snippet: ${
          verifyBodyText.slice(0, 200) || '[empty]'
        }`,
      )
    }

    stage = 'complete'
    logInfo('TUES credential diagnostic succeeded', { stage })

    return NextResponse.json({
      ok: true,
      tokenType,
      expectedStatus,
      verificationStatus: verifyResponse.status,
      verificationBodySnippet: verifyBodyText.slice(0, 400) || '[empty]',
      tokenExpiresIn: tokenPayload.expires_in ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logError('TUES credential diagnostic failed', { stage, error: message })
    return jsonErrorResponse(error, `TUES credential diagnostic failed during ${stage}`, 500, { stage })
  }
}
