export type SessionRecordingResult = {
  blob: Blob
  mimeType: string
  durationMs: number
}

type PlaybackResult = {
  durationMs: number
}

const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

export class SessionRecorder {
  private audioCtx: AudioContext | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType: string = 'audio/webm'
  private startedAt = 0

  async start(): Promise<void> {
    if (typeof window === 'undefined') throw new Error('SessionRecorder unavailable')
    if (this.recorder && this.recorder.state === 'recording') return

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const ctx = new AudioContext()
    await ctx.resume()
    const destination = ctx.createMediaStreamDestination()
    const micSource = ctx.createMediaStreamSource(stream)
    micSource.connect(destination)

    const supportedMime = SUPPORTED_MIME_TYPES.find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate)
      } catch {
        return false
      }
    })

    const recorder = supportedMime
      ? new MediaRecorder(destination.stream, { mimeType: supportedMime })
      : new MediaRecorder(destination.stream)

    this.audioCtx = ctx
    this.destination = destination
    this.micStream = stream
    this.micSource = micSource
    this.recorder = recorder
    this.mimeType = supportedMime || recorder.mimeType || 'audio/webm'
    this.chunks = []
    this.startedAt = performance.now()

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) {
        this.chunks.push(event.data)
      }
    }

    recorder.start()
  }

  async playAssistantBase64(base64: string, _mime?: string): Promise<PlaybackResult> {
    if (!this.audioCtx || !this.destination) throw new Error('Recorder not started')
    await this.audioCtx.resume()
    const arrayBuffer = SessionRecorder.base64ToArrayBuffer(base64)
    const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer.slice(0))
    return this.playAudioBuffer(audioBuffer)
  }

  async stop(): Promise<SessionRecordingResult> {
    if (!this.recorder) throw new Error('Recorder not started')

    if (this.recorder.state === 'inactive') {
      return { blob: new Blob([], { type: this.mimeType }), mimeType: this.mimeType, durationMs: 0 }
    }

    return await new Promise<SessionRecordingResult>((resolve) => {
      const recorder = this.recorder as MediaRecorder
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType })
        const durationMs = this.startedAt ? Math.max(0, Math.round(performance.now() - this.startedAt)) : 0
        this.cleanup()
        resolve({ blob, mimeType: this.mimeType, durationMs })
      }
      try {
        recorder.stop()
      } catch {
        this.cleanup()
        resolve({ blob: new Blob([], { type: this.mimeType }), mimeType: this.mimeType, durationMs: 0 })
      }
    })
  }

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {}
    }
    this.cleanup()
  }

  private playAudioBuffer(audioBuffer: AudioBuffer): Promise<PlaybackResult> {
    if (!this.audioCtx || !this.destination) throw new Error('Recorder not started')
    const source = this.audioCtx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.audioCtx.destination)
    source.connect(this.destination)
    const durationMs = Math.round(audioBuffer.duration * 1000)
    return new Promise<PlaybackResult>((resolve, reject) => {
      source.onended = () => resolve({ durationMs })
      try {
        source.start()
      } catch (err) {
        reject(err instanceof Error ? err : new Error('play_failed'))
      }
    })
  }

  private cleanup() {
    try {
      if (this.micSource && this.destination) {
        this.micSource.disconnect(this.destination)
      }
    } catch {}
    if (this.micStream) {
      try {
        this.micStream.getTracks().forEach((track) => track.stop())
      } catch {}
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close()
      } catch {}
    }
    this.audioCtx = null
    this.destination = null
    this.micStream = null
    this.micSource = null
    this.recorder = null
    this.chunks = []
    this.startedAt = 0
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    if (typeof atob === 'undefined') {
      throw new Error('Base64 decoding unavailable in this environment')
    }
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}

export function createSessionRecorder() {
  return new SessionRecorder()
}
