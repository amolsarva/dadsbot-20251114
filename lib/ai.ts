import OpenAI from 'openai'
import { getInterviewGuidePrompt } from './interview-guide'

const INTERVIEW_GUIDE_PROMPT = getInterviewGuidePrompt()

export async function synthesizeFollowup(userText: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return 'Tell me more about that memory—what details from that time still feel vivid to you?'
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a patient, topic-aware interviewer. Wait for pauses, ask one thoughtful follow-up at a time. Keep questions grounded in the elder interview guide supplied below.',
      },
      { role: 'system', content: INTERVIEW_GUIDE_PROMPT },
      { role: 'user', content: userText }
    ],
  })
  return resp.choices[0]?.message?.content || 'Can you elaborate?'
}
