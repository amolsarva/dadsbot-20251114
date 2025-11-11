type FoxLevel = 'info' | 'warn' | 'error'

export type FoxRecord = {
  id: string
  theory: number
  level: FoxLevel
  message: string
  details?: Record<string, unknown>
  firstTriggeredAt: string
  lastTriggeredAt: string
  count: number
}

type FoxInput = {
  id: string
  theory: number
  level?: FoxLevel
  message: string
  details?: Record<string, unknown>
}

const GLOBAL_KEY = '__dads_interview_foxes__'
const g = globalThis as unknown as Record<string, unknown>

if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = new Map<string, FoxRecord>()
}

const store = g[GLOBAL_KEY] as Map<string, FoxRecord>

export function flagFox(input: FoxInput): FoxRecord {
  const level: FoxLevel = input.level ?? 'warn'
  const now = new Date().toISOString()
  const existing = store.get(input.id)

  if (existing) {
    const next: FoxRecord = {
      ...existing,
      level: highestLevel(existing.level, level),
      message: input.message || existing.message,
      details: input.details ?? existing.details,
      lastTriggeredAt: now,
      count: existing.count + 1,
    }
    store.set(input.id, next)
    return next
  }

  const created: FoxRecord = {
    id: input.id,
    theory: input.theory,
    level,
    message: input.message,
    details: input.details,
    firstTriggeredAt: now,
    lastTriggeredAt: now,
    count: 1,
  }
  store.set(input.id, created)
  return created
}

export function listFoxes(): FoxRecord[] {
  return Array.from(store.values()).sort((a, b) => {
    if (a.lastTriggeredAt === b.lastTriggeredAt) {
      if (a.id === b.id) return 0
      return a.id < b.id ? -1 : 1
    }
    return a.lastTriggeredAt < b.lastTriggeredAt ? 1 : -1
  })
}

export function clearFoxes() {
  store.clear()
}

function highestLevel(existing: FoxLevel, incoming: FoxLevel): FoxLevel {
  if (existing === 'error' || incoming === 'error') return 'error'
  if (existing === 'warn' || incoming === 'warn') return 'warn'
  return 'info'
}

