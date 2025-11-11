import { NextResponse } from 'next/server'
import { jsonErrorResponse } from '@/lib/api-error'
import { listFoxes } from '@/lib/foxes'

export const runtime = 'nodejs'

export async function GET() {
  try {
    return NextResponse.json({ ok: true, foxes: listFoxes() })
  } catch (error) {
    return jsonErrorResponse(error, 'Failed to load fox diagnostics')
  }
}
