import { readFileSync } from 'node:fs'
import path from 'node:path'

let cachedGuide: string | null = null

export function getInterviewGuidePrompt(): string {
  if (cachedGuide) {
    return cachedGuide
  }
  const guidePath = path.join(process.cwd(), 'docs', 'interview-guide.md')
  try {
    const raw = readFileSync(guidePath, 'utf8')
    cachedGuide = `Use the following elder interview guide to ground your follow-up questions. Refer back to its stages, tone, and sample prompts.\n\n${raw}`
    return cachedGuide
  } catch (error) {
    cachedGuide =
      'Follow the elder interview guide: begin with warm memories, move through youth, adulthood, work, later years, culture, and legacy, asking sensory-rich, open questions.'
    return cachedGuide
  }
}
