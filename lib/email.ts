import { Resend } from 'resend'

import { getSecret, requireSecret } from './secrets.server'
import { createDiagnosticLogger, serializeError } from './logging'
import { maskEmail } from './default-notify-email.shared'

const logBase = createDiagnosticLogger('email')

function log(level: 'log' | 'error', step: string, payload: Record<string, unknown> = {}) {
  logBase(level, step, {
    ...payload,
    secrets: {
      mailFrom: getSecret('MAIL_FROM') ? '[set]' : null,
      enableFlag: getSecret('ENABLE_SESSION_EMAILS') ?? null,
      resend: getSecret('RESEND_API_KEY') ? '[set]' : null,
      sendgrid: getSecret('SENDGRID_API_KEY') ? '[set]' : null,
    },
  })
}

export function areSummaryEmailsEnabled() {
  const raw = getSecret('ENABLE_SESSION_EMAILS')
  if (!raw) {
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
  const from = requireSecret('MAIL_FROM').trim()
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

  const resendKey = getSecret('RESEND_API_KEY')
  if (resendKey) {
    try {
      const resend = new Resend(resendKey)
      await resend.emails.send({ from, to, subject, text: body })
      log('log', 'summary-email:dispatch:success', { provider: 'resend', toPreview: maskEmail(to) })
      return { ok: true, provider: 'resend' as const }
    } catch (error) {
      log('error', 'summary-email:dispatch:error', {
        provider: 'resend',
        error: serializeError(error),
      })
      return { ok: false, provider: 'resend' as const, error }
    }
  }

  const sendgridKey = getSecret('SENDGRID_API_KEY')
  if (sendgridKey) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sg = require('@sendgrid/mail')
      sg.setApiKey(sendgridKey)
      await sg.send({ to, from, subject, text: body })
      log('log', 'summary-email:dispatch:success', { provider: 'sendgrid', toPreview: maskEmail(to) })
      return { ok: true, provider: 'sendgrid' as const }
    } catch (error) {
      log('error', 'summary-email:dispatch:error', {
        provider: 'sendgrid',
        error: serializeError(error),
      })
      return { ok: false, provider: 'sendgrid' as const, error }
    }
  }

  log('error', 'summary-email:dispatch:no-provider', {
    toPreview: maskEmail(to),
  })
  return { skipped: true }
}

