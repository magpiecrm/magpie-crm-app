import { createFileRoute } from '@tanstack/react-router'
import { processOptOut } from '../../server/prospecting/suppression'

// Public opt-out for people found through prospect search. Anyone can ask not
// to be contacted: their identifiers go on the global suppression list (hashed)
// and any saved contact that matches is deleted.
//
// The response is identical whether or not we held anything about the person,
// so this page can't be used to test whether someone is in the database.

// Loose per-IP limit: the endpoint deletes data and needs no login.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
const recent = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  recent.set(ip, hits)
  if (recent.size > 10_000) recent.clear()
  return hits.length > MAX_PER_WINDOW
}

const STYLE = `
  :root { --bg:#fafafa; --card:#fff; --border:#e4e4e7; --text:#18181b; --muted:#52525b; --accent:#2563eb; --error:#dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg:#09090b; --card:#18181b; --border:#27272a; --text:#f4f4f5; --muted:#a1a1aa; --accent:#60a5fa; --error:#f87171; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px; max-width: 520px; width: 100%; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
  p { color: var(--muted); font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
  fieldset { border: 0; margin-bottom: 16px; }
  legend { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
  label { display: block; font-size: 12px; color: var(--muted); margin: 8px 0 4px; }
  input { width: 100%; padding: 9px 11px; font-size: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); }
  .row { display: flex; gap: 8px; } .row > div { flex: 1; min-width: 0; }
  .or { text-align: center; font-size: 12px; color: var(--muted); margin: 4px 0 12px; }
  button { width: 100%; padding: 11px; font-size: 14px; font-weight: 600; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
  .error { color: var(--error); font-size: 13px; margin-bottom: 12px; }
`

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
      `<style>${STYLE}</style></head><body><main class="card">${body}</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}

function form(error?: string) {
  return page(
    'Opt out',
    `<h1>Opt out of being contacted</h1>
    <p>We help businesses find work contact details from public professional profiles. Tell us who you are and
    we'll stop showing you in search results, delete you from every contact list here, and block you from being
    saved again. We keep only a one-way hash of what you enter, so we can recognise you without storing it.</p>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="post">
      <fieldset>
        <legend>Any of these that apply</legend>
        <label for="email">Work email</label>
        <input id="email" name="email" type="email" autocomplete="email">
        <label for="profileUrl">LinkedIn profile URL</label>
        <input id="profileUrl" name="profileUrl" type="url" placeholder="https://www.linkedin.com/in/…">
      </fieldset>
      <p class="or">and / or</p>
      <fieldset>
        <legend>Your name and employer's website</legend>
        <div class="row">
          <div><label for="firstName">First name</label><input id="firstName" name="firstName" autocomplete="given-name"></div>
          <div><label for="lastName">Last name</label><input id="lastName" name="lastName" autocomplete="family-name"></div>
        </div>
        <label for="domain">Company website</label>
        <input id="domain" name="domain" placeholder="acme.com">
      </fieldset>
      <button type="submit">Opt out</button>
    </form>`,
    error ? 400 : 200,
  )
}

const field = (data: FormData, key: string, max = 300) => String(data.get(key) ?? '').trim().slice(0, max)

export const Route = createFileRoute('/api/opt-out')({
  server: {
    handlers: {
      GET: async () => form(),
      POST: async ({ request }: { request: Request }) => {
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
        if (rateLimited(ip)) return page('Try again later', '<h1>Too many requests</h1><p>Please try again in a minute.</p>', 429)

        let data: FormData
        try {
          data = await request.formData()
        } catch {
          return form('Something went wrong reading the form. Please try again.')
        }
        const email = field(data, 'email', 254)
        const profileUrl = field(data, 'profileUrl', 500)
        const firstName = field(data, 'firstName', 100)
        const lastName = field(data, 'lastName', 100)
        const domain = field(data, 'domain', 253)

        const hasNameDomain = Boolean(firstName && lastName && domain)
        if (!email && !profileUrl && !hasNameDomain) {
          return form('Enter your email, your LinkedIn URL, or your full name with your company website.')
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return form('That email address doesn’t look right.')
        if (profileUrl && !/linkedin\.com\/in\//i.test(profileUrl)) return form('Enter a LinkedIn profile URL (linkedin.com/in/…).')

        await processOptOut({
          email: email || undefined,
          profileUrl: profileUrl || undefined,
          ...(hasNameDomain ? { firstName, lastName, domain } : {}),
        })

        return page(
          'Opted out',
          `<h1>You’re opted out</h1>
          <p>You won’t appear in search results here, and you can’t be saved to anyone’s contact list. If you were
          already on one, you’ve been removed. This is permanent.</p>`,
        )
      },
    },
  },
})
