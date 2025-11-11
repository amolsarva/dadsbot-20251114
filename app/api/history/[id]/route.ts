import { NextResponse } from 'next/server'
import { deleteSession } from '@/lib/data'
import { primeStorageContextFromHeaders } from '@/lib/blob'

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  primeStorageContextFromHeaders(request.headers)
  const id = params?.id
  if (!id) {
    return NextResponse.json({ ok: false, deleted: false, reason: 'missing_id' }, { status: 400 })
  }

  const result = await deleteSession(id)
  const status = result.ok ? 200 : 500
  return NextResponse.json(result, { status })
}
