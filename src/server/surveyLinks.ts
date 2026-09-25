import { decryptToken, encryptToken } from './crypto'

/**
 * Per-recipient survey links.
 *
 * A token identifies one respondent: `{ e: email, c: campaignId, s: surveyId }`
 * (short keys keep the URLs shorter). Tokens from test sends carry `test`, so
 * their responses work end to end but are left out of results and never touch
 * contacts. Tokens minted for a signed-in embed (`src: 'embed'`) expire, since
 * they sit in a page's HTML rather than one person's inbox.
 */
export interface SurveyToken {
  e: string
  c: number | null
  s: string
  test?: boolean
  src?: 'embed'
  /** Expiry, ms since epoch. */
  exp?: number
}

export function encodeSurveyToken(token: SurveyToken): string {
  return encryptToken(token)
}

/** Null unless the token is genuine and was issued for this survey. */
export function decodeSurveyToken(raw: string | null | undefined, surveyId: string): SurveyToken | null {
  if (!raw) return null
  const data = decryptToken(raw)
  if (!data || data.s !== surveyId || typeof data.e !== 'string' || !data.e.includes('@')) return null
  if (typeof data.exp === 'number' && data.exp < Date.now()) return null
  return {
    e: data.e.toLowerCase().trim(),
    c: typeof data.c === 'number' ? data.c : null,
    s: data.s,
    ...(data.test ? { test: true } : {}),
    ...(data.src === 'embed' ? { src: 'embed' as const } : {}),
    ...(typeof data.exp === 'number' ? { exp: data.exp } : {}),
  }
}

/**
 * Placeholders written by the email builder's survey block:
 *   {{ survey_link:<surveyId> }}
 *   {{ survey_answer:<surveyId>:<questionId>:<value> }}
 */
const PLACEHOLDER_RE = /\{\{\s*survey_(link|answer):([A-Za-z0-9-]+)(?::([A-Za-z0-9_]+):([A-Za-z0-9_.-]+))?\s*\}\}/g

/** Survey ids referenced by an email's placeholders. */
export function referencedSurveyIds(html: string): string[] {
  const ids = new Set<string>()
  for (const m of html.matchAll(PLACEHOLDER_RE)) ids.add(m[2])
  return [...ids]
}

/**
 * Replace survey placeholders with this recipient's links. One token is
 * encrypted per survey per recipient and reused for every answer link, so an
 * NPS row doesn't cost eleven encryptions.
 */
export function expandSurveyPlaceholders(
  html: string,
  opts: { appUrl: string; email: string; campaignId: number | null; test?: boolean },
): string {
  const tokens = new Map<string, string>()
  const tokenFor = (surveyId: string) => {
    let t = tokens.get(surveyId)
    if (!t) {
      t = encodeSurveyToken({ e: opts.email.toLowerCase().trim(), c: opts.campaignId, s: surveyId, ...(opts.test ? { test: true } : {}) })
      tokens.set(surveyId, t)
    }
    return t
  }

  return html.replace(PLACEHOLDER_RE, (_m, kind: string, surveyId: string, questionId?: string, value?: string) => {
    const base = `${opts.appUrl}/s/${surveyId}?t=${encodeURIComponent(tokenFor(surveyId))}`
    if (kind === 'answer' && questionId && value !== undefined) {
      return `${base}&amp;q=${encodeURIComponent(questionId)}&amp;a=${encodeURIComponent(value)}`
    }
    return base
  })
}
