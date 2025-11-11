export type SummarizableTurn = {
  role: 'user' | 'assistant'
  text?: string | null
}

function splitIntoSentences(text: string): string[] {
  const cleaned = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^['"“”]+|['"“”]+$/g, '').trim())
    .filter(Boolean)
  if (sentences.length) return sentences
  return [cleaned]
}

function scoreSentence(sentence: string, role: SummarizableTurn['role']): number {
  let score = 0
  const length = sentence.length
  if (length >= 12) score += Math.min(1.5, length / 80)
  if (/[,:;]/.test(sentence)) score += 0.2
  if (/(because|when|after|before|while|remember|recall|story|moment|detail)/i.test(sentence)) score += 0.6
  if (/\b(I|We|My|Our|He|She|They)\b/.test(sentence)) score += 0.4
  if (role === 'user') score += 1.1
  else score += 0.4
  return score
}

function finalizeSentence(sentence: string): string {
  let result = sentence.replace(/\s+/g, ' ').trim()
  if (!result) return ''
  result = result.charAt(0).toUpperCase() + result.slice(1)
  const limit = 120
  if (result.length > limit) {
    const truncated = result.slice(0, limit - 1)
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > 40) {
      result = truncated.slice(0, lastSpace) + '…'
    } else {
      result = truncated + '…'
    }
    return result
  }
  if (!/[.!?…]$/.test(result)) {
    result += '.'
  }
  return result
}

export function generateSessionTitle(
  turns: SummarizableTurn[] | undefined | null,
  options: { fallback?: string } = {},
): string | undefined {
  const fallback = options.fallback
  if (!turns || !turns.length) {
    return fallback
  }

  const candidates: { sentence: string; score: number; role: SummarizableTurn['role'] }[] = []

  for (const turn of turns) {
    if (!turn || typeof turn.text !== 'string') continue
    const trimmed = turn.text.replace(/\s+/g, ' ').trim()
    if (!trimmed) continue
    const sentences = splitIntoSentences(trimmed)
    for (const sentence of sentences) {
      const scored = scoreSentence(sentence, turn.role)
      if (scored <= 0) continue
      candidates.push({ sentence, score: scored, role: turn.role })
    }
  }

  if (!candidates.length) {
    return fallback
  }

  candidates.sort((a, b) => b.score - a.score)

  const preferred = candidates.find((entry) => entry.role === 'user' && entry.sentence.split(' ').length >= 3)
  const chosen = preferred || candidates[0]
  const finalized = finalizeSentence(chosen.sentence)
  if (finalized) {
    return finalized
  }
  return fallback
}
