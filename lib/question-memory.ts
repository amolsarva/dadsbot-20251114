import type { SessionMemorySnapshot } from './data'
import { formatDetailGuard, getFinalGuardQuestion, getQuestionPool } from './fallback-texts'

const FALLBACK_QUESTION_POOL = getQuestionPool()

export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9?\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractAskedQuestions(text: string): string[] {
  if (!text || !text.length) return []
  const matches = text.match(/[^?]*\?/g)
  if (!matches) return []
  return matches.map((question) => question.trim()).filter(Boolean)
}

export function collectAskedQuestions(sessions: SessionMemorySnapshot[]): string[] {
  const questions: string[] = []
  for (const session of sessions) {
    for (const turn of session.turns) {
      if (turn.role !== 'assistant' || !turn.text) continue
      questions.push(...extractAskedQuestions(turn.text))
    }
  }
  return questions
}

export function findLatestUserDetails(
  sessions: SessionMemorySnapshot[],
  options: { excludeSessionId?: string; limit?: number } = {},
): string[] {
  const details: string[] = []
  const { excludeSessionId, limit = 2 } = options
  for (const session of sessions) {
    if (excludeSessionId && session.id === excludeSessionId) continue
    for (let index = session.turns.length - 1; index >= 0; index -= 1) {
      const turn = session.turns[index]
      if (turn.role === 'user' && turn.text && turn.text.trim().length) {
        details.push(turn.text.trim())
        break
      }
    }
    if (details.length >= limit) break
  }
  return details.slice(0, limit)
}

function compressDetail(detail: string): string {
  const words = detail.split(/\s+/).filter(Boolean)
  if (words.length <= 14) return detail
  return words.slice(0, 14).join(' ') + '...'
}

export function pickFallbackQuestion(asked: Iterable<string>, detail?: string): string {
  const normalized = new Set<string>()
  for (const question of asked) {
    if (!question) continue
    normalized.add(normalizeQuestion(question))
  }

  if (detail) {
    const detailQuestion = formatDetailGuard(compressDetail(detail))
    if (!normalized.has(normalizeQuestion(detailQuestion))) {
      return detailQuestion
    }
  }

  for (const candidate of FALLBACK_QUESTION_POOL) {
    if (!normalized.has(normalizeQuestion(candidate))) {
      return candidate
    }
  }

  return getFinalGuardQuestion()
}
