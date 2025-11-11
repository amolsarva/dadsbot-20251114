import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { synthesizeSpeechWithOpenAi } from '@/lib/openaiTts'

const schema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav']).optional(),
  model: z.string().optional(),
  speed: z.number().positive().max(4).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, voice, format = 'mp3', model, speed } = schema.parse(body)

    const buffer = await synthesizeSpeechWithOpenAi({ text, voice: voice as any, format, model, speed })
    const audioBase64 = buffer.toString('base64')
    const mime = format === 'mp3' ? 'audio/mpeg' : `audio/${format}`

    return NextResponse.json({ ok: true, audioBase64, mime, format })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'tts_failed' }, { status: 400 })
  }
}
