// Server-side provider registry. Pulls in nodemailer and node:crypto, so the
// Settings UI must import `./descriptors` instead of this file.
//
// Checklist when adding a provider:
//   1. Descriptor entry in `descriptors.ts` (drives the settings form).
//   2. A module here exporting an `EmailProvider`.
//   3. A line in PROVIDERS below — the Record type makes omissions a
//      typecheck error rather than a runtime surprise.
//   4. Disable the provider's own click/open tracking. The app rewrites hrefs
//      and injects its own pixel in emailService.sendCampaign; provider-side
//      rewriting double-wraps those URLs and breaks /api/track/click.

import { brevoProvider } from './brevo'
import { cloudflareProvider } from './cloudflare'
import { mailchimpProvider } from './mailchimp'
import { mailgunProvider } from './mailgun'
import { postmarkProvider } from './postmark'
import { resendProvider } from './resend'
import { sendgridProvider } from './sendgrid'
import { sesProvider } from './ses'
import { smtpProvider } from './smtp'
import type { EmailProvider, ProviderId } from './types'

export const PROVIDERS: Record<ProviderId, EmailProvider> = {
  cloudflare: cloudflareProvider,
  brevo: brevoProvider,
  ses: sesProvider,
  postmark: postmarkProvider,
  sendgrid: sendgridProvider,
  mailgun: mailgunProvider,
  resend: resendProvider,
  mailchimp: mailchimpProvider,
  smtp: smtpProvider,
}

export function getProvider(id: ProviderId): EmailProvider {
  return PROVIDERS[id]
}

export { resetSmtpTransport } from './smtp'
export type { EmailProvider, ProviderId } from './types'
