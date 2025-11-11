import { NextRequest, NextResponse } from 'next/server'
import { appendTurn } from '@/lib/data'
import { primeNetlifyBlobContextFromHeaders } from '@/lib/blob'
import { z } from 'zod'

export async function POST(req: NextRequest, { params }: { params: { id: string }}) {
  primeNetlifyBlobContextFromHeaders(req.headers)
  try {
    const body = await req.json()
    const schema = z.object({
      role: z.enum(['user','assistant']),
      text: z.string().default(''),
      audio_blob_url: z.string().url().optional(),
    })
    const parsed = schema.parse(body)
    const turn = await appendTurn(params.id, parsed as any)
    return NextResponse.json(turn)
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? 'bad_request' }, { status: 400 })
  }
}
