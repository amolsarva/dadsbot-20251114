import { describe, expect, it } from 'vitest'
import { detectCompletionIntent } from '../lib/intents'

describe('detectCompletionIntent', () => {
  const positives = [
    "I'm done for now",
    'That will be all, thank you.',
    "Let's wrap this up",
    'Can we stop the conversation here?',
    'Thanks, that is enough for today.',
    "I'll talk to you later",
    'We are finished. Goodbye.',
    'No more questions for now.',
    'Please stop recording the session.',
  ]

  for (const phrase of positives) {
    it(`detects completion intent for "${phrase}"`, () => {
      const intent = detectCompletionIntent(phrase)
      expect(intent.shouldStop).toBe(true)
    })
  }

  const negatives = [
    "I'm not done yet",
    'When I am done with school I felt relieved.',
    'We should stop by the store before dinner.',
    'Later on, I finished the painting.',
    'That is itched into my memory.',
  ]

  for (const phrase of negatives) {
    it(`does not flag unrelated phrase "${phrase}"`, () => {
      const intent = detectCompletionIntent(phrase)
      expect(intent.shouldStop).toBe(false)
    })
  }
})
