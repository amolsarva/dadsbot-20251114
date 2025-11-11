import { Buffer } from 'node:buffer'
import OpenAI from 'openai'

export type OpenAiTtsVoice =
  | 'alloy'
  | 'echo'
  | 'fable'
  | 'onyx'
  | 'nova'
  | 'shimmer'

export interface OpenAiTtsOptions {
  text: string
  voice?: OpenAiTtsVoice
  model?: string
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav'
  speed?: number
}

let cachedClient: OpenAI | null = null

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY env var must be set before requesting speech synthesis')
    }
    cachedClient = new OpenAI({ apiKey })
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

  const response = await client.audio.speech.create({
    model,
    voice,
    input: text,
    response_format: format,
    speed,
  })

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// TODO(later): wire this helper into a streaming playback layer so we can swap the
// in-browser SpeechSynthesis strategy with OpenAI's Neural/NeuralHD voices once
// latency testing looks good.
//
// Example sketch (intentionally commented out until we build the wiring):
//
// export async function speakWithOpenAi(text: string) {
//   const audioBuffer = await synthesizeSpeechWithOpenAi({ text })
//   const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })
//   const url = URL.createObjectURL(blob)
//   const audio = new Audio(url)
//   audio.play()
//   return () => {
//     audio.pause()
//     URL.revokeObjectURL(url)
//   }
// }
