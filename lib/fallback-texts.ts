import { FALLBACK_TEXTS } from './fallback-texts.generated'

export { FALLBACK_TEXTS }
export type { FallbackTexts } from './fallback-texts.generated'

function applyTemplate(template: string, replacements: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`\\{${key}\\}`, 'g')
    result = result.replace(pattern, value)
  }
  return result
}

function formatList(items: string[]): string {
  const filtered = items.filter((item) => typeof item === 'string' && item.trim().length).slice(0, 3)
  if (!filtered.length) return ''
  if (filtered.length === 1) return filtered[0]
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`
  return `${filtered[0]}, ${filtered[1]}, and ${filtered[2]}`
}

export function formatSessionTitleFallback(dateInput: Date | string | number): string {
  const date = new Date(dateInput)
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const localized = validDate.toLocaleDateString()
  return applyTemplate(FALLBACK_TEXTS.sessionTitle.defaultFromDate, { DATE: localized })
}

export function formatIntroGreeting(options: { hasHistory: boolean; titles: string[] }): string {
  const { hasHistory, titles } = options
  if (!hasHistory) {
    return FALLBACK_TEXTS.introFlow.firstTimeGreeting
  }
  if (titles.length) {
    const joined = formatList(titles)
    return applyTemplate(FALLBACK_TEXTS.introFlow.returningGreetingWithTitles, { TITLES: joined })
  }
  return FALLBACK_TEXTS.introFlow.returningGreetingDefault
}

export function formatIntroReminder(details: string[]): string {
  if (details.length) {
    return applyTemplate(FALLBACK_TEXTS.introFlow.latestDetailReminder, { DETAIL: details[0] })
  }
  return FALLBACK_TEXTS.introFlow.noDetailPromise
}

export function getIntroInvitation(hasHistory: boolean): string {
  return hasHistory ? FALLBACK_TEXTS.introFlow.returningInvitation : FALLBACK_TEXTS.introFlow.firstSessionInvitation
}

export function getIntroQuestion(hasHistory: boolean, fallbackQuestion?: string | null): string {
  if (hasHistory) {
    return fallbackQuestion && fallbackQuestion.trim().length
      ? fallbackQuestion
      : FALLBACK_TEXTS.introFlow.defaultContinuationQuestion
  }
  return FALLBACK_TEXTS.introFlow.firstSessionQuestion
}

export function getIntroClientFallback(): string {
  return FALLBACK_TEXTS.introFlow.clientFallback
}

export function formatDetailGuard(detail: string): string {
  return applyTemplate(FALLBACK_TEXTS.questions.detailGuard, { DETAIL: detail })
}

export function getQuestionPool(): readonly string[] {
  return FALLBACK_TEXTS.questions.promptPool
}

export function getFinalGuardQuestion(): string {
  return FALLBACK_TEXTS.questions.finalGuard
}

export function getAskFirstSessionGreeting(): string {
  return FALLBACK_TEXTS.askTurn.firstSessionGreeting
}

export function formatAskReturningWithHighlight(highlight: string): string {
  return applyTemplate(FALLBACK_TEXTS.askTurn.returningWithHighlight, { HIGHLIGHT: highlight })
}

export function getAskReturningDefault(): string {
  return FALLBACK_TEXTS.askTurn.returningDefault
}

export function getAskProviderExceptionPrompt(): string {
  return FALLBACK_TEXTS.askTurn.providerException
}
