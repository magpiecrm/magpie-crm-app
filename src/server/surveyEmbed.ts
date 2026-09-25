import { db } from './db'
import { notify } from './notify'
import { encodeSurveyToken } from './surveyLinks'

/** Long enough for a working session; short enough that a leaked iframe URL goes stale. */
const EMBED_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type IssueEmbedTokenResult =
  | {
      status: 200
      body: { url: string; token: string; expiresAt: string; contact: 'existing' | 'created' | 'not_created' }
    }
  | { status: 400 | 404 | 409; body: { error: string } }

/**
 * Mint a personal survey link for a user who is signed in to another app (the
 * embedding site). Called server-to-server with an API key, so the email is
 * vouched for by that app's backend rather than typed or put in a URL where it
 * could be changed.
 *
 * Contact creation follows the survey's own rule, like Forms: an unknown email
 * becomes a subscribed contact on the survey's list when one is set; otherwise
 * the response is still tied to the email but no contact is created.
 */
export function issueEmbedToken(input: {
  surveyId: string
  email: unknown
  firstName?: unknown
  lastName?: unknown
  appUrl: string
  now?: number
}): IssueEmbedTokenResult {
  const survey = db.getSurvey(input.surveyId)
  if (!survey) return { status: 404, body: { error: 'Survey not found' } }
  if (survey.status !== 'published') return { status: 409, body: { error: `Survey is ${survey.status}; publish it first.` } }

  const email = typeof input.email === 'string' ? input.email.toLowerCase().trim() : ''
  if (!EMAIL_RE.test(email) || email.length > 320) return { status: 400, body: { error: 'A valid "email" is required.' } }

  const name = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 100) : '')
  let contact: 'existing' | 'created' | 'not_created' = db.getContact(email) ? 'existing' : 'not_created'

  if (contact === 'not_created' && survey.settings.listId) {
    db.upsertContact(email, { builtin: { first_name: name(input.firstName), last_name: name(input.lastName) } }, { create: true, status: 'subscribed' })
    db.addContactToList(survey.settings.listId, email)
    notify('contact_added', `${email} was added via survey "${survey.name}"`, { contactEmail: email })
    contact = 'created'
  }

  const exp = (input.now ?? Date.now()) + EMBED_TOKEN_TTL_MS
  const token = encodeSurveyToken({ e: email, c: null, s: survey.id, src: 'embed', exp })
  return {
    status: 200,
    body: {
      url: `${input.appUrl}/s/${survey.id}?embed=1&t=${encodeURIComponent(token)}`,
      token,
      expiresAt: new Date(exp).toISOString(),
      contact,
    },
  }
}
