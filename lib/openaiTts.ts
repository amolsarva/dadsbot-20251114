import { Buffer } from 'node:buffer'
import OpenAI from 'openai'

import { getSecret, requireSecret } from './secrets.server'
import { createDiagnosticLogger, serializeError } from './logging'

export type OpenAiTtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export interface OpenAiTtsOptions {
  text: string
  voice?: OpenAiTtsVoice
  model?: string
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav'
  speed?: number
}

let cachedClient: OpenAI | null = null
const log = createDiagnosticLogger('ai-tts')

function getClient() {
  if (!cachedClient) {
    const apiKey = requireSecret('OPENAI_API_KEY')
    cachedClient = new OpenAI({ apiKey })
    log('log', 'client:initialized', {})
  }
  return cachedClient
}

export async function synthesizeSpeechWithOpenAi({
  text,
  voice = 'alloy',
  model = 'gpt-4o-mini-tts',
  format = 'mp3',
  speed = 1,
}: OpenAiTtsOptions) {
  const client = getClient()
  log('log', 'synthesis:start', {
    textLength: text.length,
    voice,
    model,
    format,
    speed,
  })
  try {
    const response = await client.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: format,
      speed,
    })
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    log('log', 'synthesis:success', { bytes: buffer.byteLength })
    return buffer
  } catch (error) {
    log('error', 'synthesis:failed', { error: serializeError(error) })
    throw new Error('Failed to synthesize speech using OpenAI.')
  }
}

export function isOpenAiTtsConfigured() {
  const key = getSecret('OPENAI_API_KEY')
  return Boolean(key)
}

