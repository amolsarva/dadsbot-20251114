export type CompletionIntent = {
  shouldStop: boolean
  confidence: 'low' | 'medium' | 'high'
  matchedPhrases: string[]
}

const NEGATING_PHRASES = [
  /not\s+done/i,
  /not\s+finished/i,
  /not\s+yet/i,
  /(?:when|once)\s+i\s+(?:am|was|were)?\s*(?:done|finished)/i,
]

const PATTERN_LIBRARY: { pattern: RegExp; weight: number; phrase: string }[] = [
  { pattern: /(i['\s]?m|i am)\s+(done|finished|good)\b/, weight: 2.5, phrase: "i'm done" },
  { pattern: /(we['\s]?re|we are)\s+(done|finished)\b/, weight: 2.3, phrase: "we are done" },
  { pattern: /(that['\s]?s|that is)\s+(it|all|enough)\b/, weight: 2.1, phrase: "that's it" },
  { pattern: /(let['\s]?s|lets)\s+(stop|wrap up|call it a day|pause)/, weight: 2.2, phrase: "let's wrap up" },
  { pattern: /(can|could|may|should)\s+we\s+(stop|wrap up|pause|finish)\b/, weight: 2.2, phrase: 'can we stop' },
  { pattern: /(stop|end)\s+(the\s+)?(session|conversation|recording|interview)\b/, weight: 2.4, phrase: 'stop the session' },
  { pattern: /(stop|pause)\s+(here|there|for now)/, weight: 2.1, phrase: 'stop here' },
  { pattern: /(call)\s+it\s+(a day|there)/, weight: 2.0, phrase: 'call it a day' },
  { pattern: /(pick|take)\s+(this|it)\s+up\s+(later|another time)/, weight: 1.8, phrase: 'pick this up later' },
  { pattern: /(talk|speak|chat)\s+(later|another time|next time)/, weight: 1.8, phrase: 'talk later' },
  { pattern: /(goodbye|bye for now|bye-bye)/, weight: 1.7, phrase: 'goodbye' },
  { pattern: /(no more|nothing else)\s+(questions|for now|today)/, weight: 2.0, phrase: 'no more questions' },
  { pattern: /(that will|that'll)\s+be\s+all/, weight: 2.2, phrase: "that will be all" },
  { pattern: /(thank you|thanks)[,!\s]+(that['\s]?s|that is)\s+(all|it|enough)/, weight: 2.3, phrase: "thanks that's all" },
  { pattern: /(i|we)\s+(need|have)\s+to\s+(go|run|leave)/, weight: 1.6, phrase: 'i have to go' },
  { pattern: /(i['\s]?m|i am)\s+(wrapping|signing)\s+off/, weight: 1.9, phrase: "i'm wrapping up" },
  { pattern: /(enough for|done for|finished for)\s+(now|today|tonight)/, weight: 2.2, phrase: 'enough for now' },
  { pattern: /(stop|end)\s+(asking|with)\s+(questions|that)/, weight: 1.9, phrase: 'stop with the questions' },
  { pattern: /(that['\s]?s|that is)\s+probably\s+(enough|good)/, weight: 1.6, phrase: "that's enough" },
  { pattern: /(wrap|close)\s+(this|things)\s+up/, weight: 2.0, phrase: 'wrap this up' },
  { pattern: /(i['\s]?ll|i will)\s+(talk|speak|chat)\s+to\s+you\s+(later|soon)/, weight: 1.7, phrase: 'talk to you later' },
  { pattern: /(we can|let's)\s+(be|call it)\s+(done|good)/, weight: 1.7, phrase: 'call it done' },
]

const TOKEN_COMBINATIONS: { tokens: string[]; weight: number; phrase: string }[] = [
  { tokens: ['wrap', 'up'], weight: 1.6, phrase: 'wrap up' },
  { tokens: ['stop', 'talking'], weight: 1.7, phrase: 'stop talking' },
  { tokens: ['stop', 'recording'], weight: 1.8, phrase: 'stop recording' },
  { tokens: ['all', 'done'], weight: 1.6, phrase: 'all done' },
  { tokens: ['done', 'for', 'now'], weight: 1.9, phrase: 'done for now' },
  { tokens: ['finished', 'for', 'now'], weight: 1.9, phrase: 'finished for now' },
  { tokens: ['no', 'more', 'questions'], weight: 2.0, phrase: 'no more questions' },
  { tokens: ['ready', 'to', 'stop'], weight: 1.6, phrase: 'ready to stop' },
  { tokens: ['that', 'is', 'it'], weight: 1.6, phrase: 'that is it' },
]

const STOP_TOKENS = new Set([
  'done',
  'finished',
  'stop',
  'pause',
  'wrap',
  'goodbye',
  'bye',
  'later',
  'enough',
  'quit',
  'exit',
  'over',
  'complete',
])

const CONTEXT_TOKENS = new Set(['now', 'today', 'tonight', 'here', 'there', 'anymore', 'for', 'this', 'session', 'conversation'])

export function detectCompletionIntent(input: string | null | undefined): CompletionIntent {
  const result: CompletionIntent = { shouldStop: false, confidence: 'low', matchedPhrases: [] }
  if (!input) return result

  const normalized = input.trim().toLowerCase()
  if (!normalized.length) return result

  for (const neg of NEGATING_PHRASES) {
    if (neg.test(normalized)) {
      return result
    }
  }

  let score = 0
  for (const { pattern, weight, phrase } of PATTERN_LIBRARY) {
    if (pattern.test(normalized)) {
      score += weight
      result.matchedPhrases.push(phrase)
    }
  }

  const cleanedTokens = normalized.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const tokenSet = new Set(cleanedTokens)

  for (const { tokens, weight, phrase } of TOKEN_COMBINATIONS) {
    if (tokens.every((token) => tokenSet.has(token))) {
      score += weight
      result.matchedPhrases.push(phrase)
    }
  }

  const stopTokenMatches = cleanedTokens.filter((token) => STOP_TOKENS.has(token))
  const contextMatches = cleanedTokens.filter((token) => CONTEXT_TOKENS.has(token))
  if (stopTokenMatches.length && contextMatches.length) {
    score += 1.4
    result.matchedPhrases.push(`${stopTokenMatches[0]} ${contextMatches[0]}`.trim())
  }

  if (score >= 3.5) {
    result.shouldStop = true
    result.confidence = 'high'
  } else if (score >= 2.2) {
    result.shouldStop = true
    result.confidence = 'medium'
  } else if (score >= 1.6) {
    result.shouldStop = true
    result.confidence = 'low'
  }

  // Deduplicate matched phrases
  if (result.matchedPhrases.length) {
    result.matchedPhrases = Array.from(new Set(result.matchedPhrases))
  }

  return result
}
