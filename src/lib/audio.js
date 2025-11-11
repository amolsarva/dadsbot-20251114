function createBandpass(ctx) {
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 250
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3600
  hp.connect(lp)
  return { input: hp, output: lp }
}

function rms(buf) {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

export async function calibrateRMS(seconds = 2.0) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const { input, output } = createBandpass(ctx)
  src.connect(input)
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  output.connect(an)
  const data = new Float32Array(an.fftSize)
  const samples = []
  const end = performance.now() + seconds * 1000
  while (performance.now() < end) {
    an.getFloatTimeDomainData(data)
    samples.push(rms(data))
    await new Promise((r) => setTimeout(r, 50))
  }
  stream.getTracks().forEach((t) => t.stop())
  await ctx.close()

  if (!samples.length) return 0.01

  samples.sort((a, b) => a - b)
  const keepCount = Math.max(1, Math.floor(samples.length * 0.7))
  const trimmed = samples.slice(0, keepCount)
  const median = trimmed[Math.floor(trimmed.length / 2)] ?? 0.01
  const mean =
    trimmed.reduce((sum, value) => (Number.isFinite(value) ? sum + value : sum), 0) /
    trimmed.length
  const candidate = Number.isFinite(median) ? median : Number.isFinite(mean) ? mean : 0.01
  const MIN_BASELINE = 0.0001
  const MAX_BASELINE = 0.05
  const baseline = Math.min(Math.max(candidate, MIN_BASELINE), MAX_BASELINE)
  return baseline
}

export async function recordUntilSilence(options) {
  const {
    baseline,
    minDurationMs = 1200,
    maxDurationMs = 180000,
    silenceMs = 1600,
    graceMs = 600,
    shouldForceStop = () => false,
    startRatio = 3.0,
    stopRatio = 2.0,
  } = options

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const { input, output } = createBandpass(ctx)
  src.connect(input)
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  output.connect(an)
  const proc = ctx.createScriptProcessor(2048, 1, 1)
  output.connect(proc)
  proc.connect(ctx.destination)
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks = []
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data)
  }
  let started = false
  let startedAt = 0
  let lastLoud = performance.now()
  let quietStreak = 0
  let loudStreak = 0
  const data = new Float32Array(an.fftSize)
  let stopReason = 'unknown'

  return await new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      cleanup()
      resolve(result)
    }

    rec.onstop = () => {
      if (done) return
      const blob = new Blob(chunks, { type: mime })
      const durationMs = started ? Math.max(0, performance.now() - startedAt) : 0
      finish({ blob, durationMs, started, stopReason })
    }

    proc.onaudioprocess = () => {
      if (done) return
      an.getFloatTimeDomainData(data)
      const safeBaseline = baseline > 0.0001 ? baseline : 0.0001
      const level = rms(data) / safeBaseline
      const now = performance.now()
      if (!started) {
        if (shouldForceStop()) {
          stopReason = 'force_stop_before_start'
          finish({ blob: new Blob([], { type: mime }), durationMs: 0, started: false, stopReason })
          return
        }
        if (level >= startRatio) {
          if (++loudStreak >= 3) {
            started = true
            startedAt = now
            rec.start()
            stopReason = 'pending'
          }
        } else {
          loudStreak = 0
        }
      } else {
        if (level < stopRatio) quietStreak++
        else {
          quietStreak = 0
          lastLoud = now
        }
        const elapsed = now - startedAt
        const silenceElapsed = now - lastLoud
        if (elapsed >= maxDurationMs) {
          stopReason = 'max_duration'
          rec.stop()
        } else if (shouldForceStop()) {
          stopReason = 'force_stop_after_start'
          if (rec.state === 'recording') rec.stop()
          else finish({ blob: new Blob(chunks, { type: mime }), durationMs: elapsed, started, stopReason })
        } else if (elapsed >= minDurationMs && quietStreak >= 8 && silenceElapsed >= silenceMs + graceMs) {
          stopReason = 'silence'
          rec.stop()
        }
      }
    }
    function cleanup() {
      try {
        proc.disconnect()
        output.disconnect()
      } catch {}
      try {
        stream.getTracks().forEach((t) => t.stop())
      } catch {}
      try {
        ctx.close()
      } catch {}
    }
  })
}

export async function blobToBase64(blob) {
  return new Promise((res) => {
    const reader = new FileReader()
    reader.onload = () => res(String(reader.result).split(',')[1])
    reader.readAsDataURL(blob)
  })
}
