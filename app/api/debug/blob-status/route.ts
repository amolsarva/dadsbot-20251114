import { NextRequest, NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment, primeStorageContextFromHeaders } from '@/lib/blob'
import { jsonErrorResponse } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    primeStorageContextFromHeaders(request.headers)
    const env = getBlobEnvironment()
    const health = await blobHealth()
    return NextResponse.json({ env, health })
  } catch (error) {
    return jsonErrorResponse(error, 'Failed to inspect blob diagnostics')
  }
}
