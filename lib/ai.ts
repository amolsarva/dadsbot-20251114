import OpenAI from 'openai'

import { getSecret } from './secrets.server'
import { createDiagnosticLogger, serializeError } from './logging'
import { getInterviewGuidePrompt } from './interview-guide'

const INTERVIEW_GUIDE_PROMPT = getInterviewGuidePrompt()
const log = createDiagnosticLogger('ai-followup')

export async function synthesizeFollowup(userText: string): Promise<string> {
  const apiKey = getSecret('OPENAI_API_KEY')
  if (!apiKey) {
    log('log', 'fallback:no-api-key', { userTextLength: userText.length })
    return 'Tell me more about that memory—what details from that time still feel vivid to you?'
  }

  log('log', 'request:start', { userTextLength: userText.length })
  const client = new OpenAI({ apiKey })
  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a patient, topic-aware interviewer. Wait for pauses, ask one thoughtful follow-up at a time. Keep questions grounded in the elder interview guide supplied below.',
        },
        { role: 'system', content: INTERVIEW_GUIDE_PROMPT },
        { role: 'user', content: userText },
      ],
    })
    const message = resp.choices[0]?.message?.content || 'Can you elaborate?'
    log('log', 'request:success', { responseLength: message.length })
    return message
  } catch (error) {
    log('error', 'request:failed', { error: serializeError(error) })
    throw new Error('Failed to generate follow-up prompt from OpenAI.')
  }
}

