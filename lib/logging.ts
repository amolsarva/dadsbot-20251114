export type DiagnosticLevel = 'log' | 'error'

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause ?? null,
    }
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch {
      return { ...error }
    }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  return { message: 'Unknown error', value: error }
}

export function createDiagnosticLogger(namespace: string) {
  return function log(level: DiagnosticLevel, event: string, payload?: Record<string, unknown>) {
    const entry = {
      ...(payload ?? {}),
      env: {
        netlify: process.env.NETLIFY ?? null,
        nodeEnv: process.env.NODE_ENV ?? null,
      },
    }
    const message = `[diagnostic] ${new Date().toISOString()} ${namespace}:${event}`
    if (level === 'error') {
      console.error(message, entry)
    } else {
      console.log(message, entry)
    }
  }
}

