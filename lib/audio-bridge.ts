// Thin typed wrapper around the legacy JS audio helpers used on the client
// This avoids TS build errors while reusing the proven implementation.

export type RecordResult = {
  blob: Blob
  durationMs: number
  started: boolean
  stopReason: string
}

async function getModule(): Promise<any> {
  // Dynamic import so it only loads client-side
  try {
    // @ts-ignore
    return await import('../src/lib/audio.js')
  } catch {
    // @ts-ignore
    return await import('../src/lib/audio')
  }
}

export async function calibrateRMS(seconds = 2.0): Promise<number> {
  const mod = await getModule()
  return typeof mod.calibrateRMS === 'function' ? await mod.calibrateRMS(seconds) : 0
}

export async function recordUntilSilence(args: any): Promise<RecordResult> {
  const mod = await getModule()
  if (typeof mod.recordUntilSilence !== 'function') throw new Error('Audio recording unavailable')
  return await mod.recordUntilSilence(args)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const mod = await getModule()
  return typeof mod.blobToBase64 === 'function' ? await mod.blobToBase64(blob) : ''
}


