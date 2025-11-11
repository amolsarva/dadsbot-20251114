'use client'
// TODO(later): consolidate this helper with the OpenAI-backed speech module once we
// have server-side streaming in place (see lib/openaiTts.ts).
export function speak(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1
    u.pitch = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    // Reminder: once we switch to OpenAI voices, expose a toggle so we can fall back to
    // native SpeechSynthesis when offline or when the API quota is exhausted.
  } catch {}
}
