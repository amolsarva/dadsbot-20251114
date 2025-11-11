import { Resend } from 'resend'
import { maskEmail } from './default-notify-email.shared'

function timestamp() {
  return new Date().toISOString()
}

function emailEnvSummary() {
  return {
    mailFrom: process.env.MAIL_FROM ? 'set' : 'missing',
    enableSessionEmails: process.env.ENABLE_SESSION_EMAILS ?? null,
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    sendgridConfigured: Boolean(process.env.SENDGRID_API_KEY),
  }
}

type DiagnosticLevel = 'log' | 'error'

function log(level: DiagnosticLevel, step: string, payload: Record<string, unknown> = {}) {
  const entry = {
    ...payload,
    envSummary: emailEnvSummary(),
  }
  const message = `[diagnostic] ${timestamp()} ${step} ${JSON.stringify(entry)}`
  if (level === 'error') {
    console.error(message)
  } else {
    console.log(message)
  }
}

export function areSummaryEmailsEnabled() {
  const raw = process.env.ENABLE_SESSION_EMAILS
  if (raw === undefined) {
    log('log', 'summary-email:flag-default-enabled')
    return true
  }
  const normalized = raw.trim().toLowerCase()
  if (['false', '0', 'off', 'disable', 'disabled'].includes(normalized)) {
    log('log', 'summary-email:flag-disabled', { raw })
    return false
  }
  if (['true', '1', 'on', 'enable', 'enabled'].includes(normalized)) {
    log('log', 'summary-email:flag-enabled', { raw })
    return true
  }
  log('error', 'summary-email:flag-unrecognized', { raw })
  return true
}

export async function sendSummaryEmail(to: string, subject: string, body: string) {
  const fromRaw = process.env.MAIL_FROM
  if (typeof fromRaw !== 'string') {
    log('error', 'summary-email:missing-from', { reason: 'not_set' })
    throw new Error('MAIL_FROM is required for summary emails but was not provided.')
  }
  const from = fromRaw.trim()
  if (!from.length) {
    log('error', 'summary-email:missing-from', { reason: 'empty_after_trim' })
    throw new Error('MAIL_FROM is required for summary emails but was not provided.')
  }

  if (!areSummaryEmailsEnabled()) {
    log('log', 'summary-email:skipped-disabled')
    return { skipped: true }
  }

  if (!to || !/.+@.+/.test(to)) {
    log('error', 'summary-email:invalid-recipient', { toPreview: maskEmail(to) })
    return { skipped: true }
  }

  log('log', 'summary-email:dispatch:start', {
    toPreview: maskEmail(to),
    subjectPreview: subject ? subject.slice(0, 120) : null,
  })

  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({ from, to, subject, text: body })
      log('log', 'summary-email:dispatch:success', { provider: 'resend', toPreview: maskEmail(to) })
      return { ok: true, provider: 'resend' }
    } catch (e:any) {
      const message = typeof e?.message === 'string' ? e.message : 'resend_failed'
      log('error', 'summary-email:dispatch:error', {
        provider: 'resend',
        error: message,
      })
      return { ok: false, provider: 'resend', error: message }
    }
  }

  if (process.env.SENDGRID_API_KEY) {
    try {
      const sg = require('@sendgrid/mail')
      sg.setApiKey(process.env.SENDGRID_API_KEY)
      await sg.send({ to, from, subject, text: body })
      log('log', 'summary-email:dispatch:success', { provider: 'sendgrid', toPreview: maskEmail(to) })
      return { ok: true, provider: 'sendgrid' }
    } catch (e:any) {
      const message = typeof e?.message === 'string' ? e.message : 'sendgrid_failed'
      log('error', 'summary-email:dispatch:error', {
        provider: 'sendgrid',
        error: message,
      })
      return { ok: false, provider: 'sendgrid', error: message }
    }
  }

  log('error', 'summary-email:dispatch:no-provider', {
    toPreview: maskEmail(to),
  })
  return { skipped: true }
}
