import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { blobHealth, deleteBlob, getBlobEnvironment, primeStorageContextFromHeaders, putBlobFromBuffer, readBlob } from '@/lib/blob'
import { jsonErrorResponse } from '@/lib/api-error'
import { createDiagnosticLogger, serializeError } from '@/lib/logging'
import type { BlobErrorReport } from '@/types/error-types'

const ROUTE_NAME = 'app/api/diagnostics/storage'
const log = createDiagnosticLogger('diagnostics:storage')

const HYPOTHESES = [
  'Supabase storage credentials may be missing from tmpkeys.txt.',
  'Bucket permissions could block read/write probes.',
  'Fallback memory mode may be active, limiting persistence.',
]

type FlowStep = {
  id: string
  label: string
  ok: boolean
  optional?: boolean
  skipped?: boolean
  status?: number
  durationMs?: number
  message?: string
  error?: string
  details?: unknown
}

type FlowDiagnostics = {
  ok: boolean
  probeId: string
  startedAt: string
  steps: FlowStep[]
  mode: string
}

function logRoute(level: 'log' | 'error', step: string, payload: Record<string, unknown> = {}) {
  log(level, `${ROUTE_NAME}:${step}`, { route: ROUTE_NAME, hypotheses: HYPOTHESES, ...payload })
}

export async function GET(req: NextRequest) {
  logRoute('log', 'start', { method: req.method, url: req.url })

  try {
    const primed = primeStorageContextFromHeaders(req.headers)
    logRoute('log', 'context:primed', { primed })

    const env = getBlobEnvironment()
    logRoute('log', 'environment:resolved', { env })
    const envError = (env.error ?? null) as BlobErrorReport | null

    const health = await blobHealth()
    logRoute('log', 'health:resolved', { health })

    const probeId = randomUUID()
    const startedAt = new Date().toISOString()
    const steps: FlowStep[] = []
    const diagnostics: FlowDiagnostics = {
      ok: false,
      probeId,
      startedAt,
      steps,
      mode: env.provider,
    }

    if (!env.configured || envError) {
      diagnostics.steps.push({
        id: 'storage-unconfigured',
        label: 'Storage configuration check',
        ok: false,
        error: envError ? envError.message ?? 'Storage reported an initialization error.' : 'Storage is not configured.',
        details: envError ?? env,
      })
      diagnostics.ok = false
      return NextResponse.json({ ok: false, env, health, diagnostics }, { status: 500 })
    }

    const path = `diagnostics/${probeId}/probe.json`
    const payload = Buffer.from(JSON.stringify({ probeId, startedAt }, null, 2), 'utf8')

    const uploadStart = Date.now()
    try {
      await putBlobFromBuffer(path, payload, 'application/json', { cacheControlMaxAge: 30 })
      steps.push({
        id: 'upload',
        label: 'Upload diagnostic payload',
        ok: true,
        durationMs: Date.now() - uploadStart,
      })
    } catch (error) {
      steps.push({
        id: 'upload',
        label: 'Upload diagnostic payload',
        ok: false,
        durationMs: Date.now() - uploadStart,
        error: error instanceof Error ? error.message : 'Upload failed',
        details: serializeError(error),
      })
      diagnostics.ok = false
      return NextResponse.json({ ok: false, env, health, diagnostics }, { status: 500 })
    }

    const readStart = Date.now()
    try {
      const record = await readBlob(path)
      if (!record) {
        steps.push({
          id: 'read',
          label: 'Read diagnostic payload',
          ok: false,
          durationMs: Date.now() - readStart,
          error: 'Read succeeded but returned no data.',
        })
        diagnostics.ok = false
        return NextResponse.json({ ok: false, env, health, diagnostics }, { status: 500 })
      }
      steps.push({
        id: 'read',
        label: 'Read diagnostic payload',
        ok: true,
        durationMs: Date.now() - readStart,
        details: { bytes: record.buffer.byteLength },
      })
    } catch (error) {
      steps.push({
        id: 'read',
        label: 'Read diagnostic payload',
        ok: false,
        durationMs: Date.now() - readStart,
        error: error instanceof Error ? error.message : 'Read failed',
        details: serializeError(error),
      })
      diagnostics.ok = false
      return NextResponse.json({ ok: false, env, health, diagnostics }, { status: 500 })
    }

    const deleteStart = Date.now()
    try {
      await deleteBlob(path)
      steps.push({
        id: 'delete',
        label: 'Delete diagnostic payload',
        ok: true,
        durationMs: Date.now() - deleteStart,
      })
    } catch (error) {
      steps.push({
        id: 'delete',
        label: 'Delete diagnostic payload',
        ok: false,
        durationMs: Date.now() - deleteStart,
        error: error instanceof Error ? error.message : 'Delete failed',
        details: serializeError(error),
      })
      diagnostics.ok = false
      return NextResponse.json({ ok: false, env, health, diagnostics }, { status: 500 })
    }

    diagnostics.ok = steps.every((step) => step.ok)
    logRoute('log', 'complete', { diagnostics })

    return NextResponse.json({ ok: diagnostics.ok, env, health, diagnostics })
  } catch (error) {
    logRoute('error', 'exception', { error: serializeError(error) })
    return jsonErrorResponse(error, 'Storage diagnostics failed')
  }
}

