// The stand-in for every outside service the app talks to, on one port: the
// host's APIs (verification, AI, sending domains, billing, the shared
// database, signals, warmup), SocialFetch, web search, Anthropic and OpenAI,
// plus the stack's DNS (dns.ts) on a UDP port. Its answers come from the
// made-up world in fixtures.ts, so every run finds the same people.
//
// For tests and agents, besides the real paths:
//   GET  /__health          up?
//   GET  /__log             every call the app made (method, path, body), oldest first; ?path=/v1/pool to filter
//   POST /__reset           clears the log and every override
//   POST /__control         overrides, e.g. {"fail": {"/v1/check_email": 503}} or {"ai": {"text": "…"}}
//
// Run by up.ts; on its own: HOST_PORT=4701 DNS_PORT=4753 bun test/stack/host.ts

import { answer, Zone } from './dns'
import { COMPANIES } from './fixtures'
import { routes, type Ctx } from './hostRoutes'

const port = Number(process.env.HOST_PORT) || 4701
const dnsPort = Number(process.env.DNS_PORT) || 4753

interface Logged {
  at: string
  method: string
  path: string
  query: string
  body: unknown
  status: number
}

const log: Logged[] = []
const zone = new Zone()

/** What a test has asked the stand-in to do differently. */
export interface Overrides {
  /** Path prefix → status to answer with instead. */
  fail: Record<string, number>
  /** The AI's next replies, in order (then back to the default). */
  ai: Array<{ text?: string; toolUse?: { name: string; input: unknown } }>
  /** Extra state routes can read (e.g. a sending domain's status). */
  [key: string]: unknown
}
let overrides: Overrides = { fail: {}, ai: [] }

function seedZone() {
  for (const c of COMPANIES) {
    if (c.format !== 'no-mx') zone.set(c.domain, [{ type: 'MX', preference: 10, exchange: `mx.${c.domain}` }, { type: 'TXT', text: `v=spf1 mx -all` }])
    else zone.set(c.domain, [{ type: 'A', address: '192.0.2.10' }])
    zone.set(`mx.${c.domain}`, [{ type: 'A', address: '192.0.2.25' }])
  }
  // Senders' domains: made ready by the sending-domain routes (hostRoutes.ts).
  zone.set('magpie.test', [{ type: 'MX', preference: 10, exchange: 'mail.magpie.test' }])
  zone.set('mail.magpie.test', [{ type: 'A', address: '127.0.0.1' }])
}
seedZone()

const ctx: Ctx = { zone, overrides: () => overrides, appUrl: process.env.APP_URL ?? '', secret: process.env.HOST_SECRET ?? '', mode: process.env.MODE === 'self-hosted' ? 'self-hosted' : 'hosted' }

const json = (body: unknown, status = 200) => Response.json(body, { status })

Bun.serve({
  port,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/__health') return json({ ok: true })
    if (path === '/__log') {
      const prefix = url.searchParams.get('path')
      return json(prefix ? log.filter((l) => l.path.startsWith(prefix)) : log)
    }
    if (path === '/__reset' && request.method === 'POST') {
      log.length = 0
      overrides = { fail: {}, ai: [] }
      seedZone()
      return json({ ok: true })
    }
    if (path === '/__control' && request.method === 'POST') {
      const body = (await request.json()) as Partial<Overrides>
      overrides = { ...overrides, ...body, fail: { ...overrides.fail, ...(body.fail ?? {}) }, ai: [...overrides.ai, ...(body.ai ?? [])] }
      return json(overrides)
    }

    const raw = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
    let body: unknown = raw
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {}
    const entry: Logged = { at: new Date().toISOString(), method: request.method, path, query: url.search, body, status: 0 }
    log.push(entry)
    if (log.length > 5000) log.shift()

    const failing = Object.entries(overrides.fail).find(([prefix]) => path.startsWith(prefix))
    if (failing) {
      entry.status = failing[1]
      return json({ error: 'stand-in failure (/__control)' }, failing[1])
    }

    for (const route of routes) {
      if (route.method !== request.method && route.method !== '*') continue
      const match = typeof route.path === 'string' ? (path === route.path ? [] : null) : route.path.exec(path)
      if (!match) continue
      try {
        const res = await route.handle({ request, url, body, params: match.slice(1), ctx })
        entry.status = res.status
        return res
      } catch (err) {
        entry.status = 500
        console.error(`[host] ${request.method} ${path} failed:`, err)
        return json({ error: String(err) }, 500)
      }
    }
    entry.status = 404
    console.warn(`[host] no stand-in for ${request.method} ${path}`)
    return json({ error: `the stand-in host has no ${request.method} ${path}` }, 404)
  },
})

await Bun.udpSocket({
  hostname: '127.0.0.1',
  port: dnsPort,
  socket: {
    data(socket, data, fromPort, fromAddress) {
      try {
        socket.send(answer(new Uint8Array(data), zone), fromPort, fromAddress)
      } catch (err) {
        console.error('[dns] bad query:', err)
      }
    },
  },
})

// ── Delivery reports ────────────────────────────────────────────────────────
// A hosted copy hears from the host's mail server when each email is delivered
// (or bounces): POST /api/webhooks/email/smtp?s=WEBHOOK_SECRET with
// { events: [{ email, type, at, campaign? }] } (providers/smtp.ts). Opens are
// judged against that delivery time. Here every email Mailpit catches is
// reported delivered, except to an address starting "bounce", which hard-bounces.
const mailpit = process.env.MAILPIT_URL
const webhookSecret = process.env.WEBHOOK_SECRET
if (ctx.mode === 'hosted' && mailpit && webhookSecret && ctx.appUrl) {
  const reported = new Set<string>()
  const report = async () => {
    const list = (await (await fetch(`${mailpit}/api/v1/messages?limit=200`)).json()) as { messages: Array<{ ID: string; Created: string; To: Array<{ Address: string }> }> }
    const fresh = list.messages.filter((m) => !reported.has(m.ID))
    if (!fresh.length) return
    const events: unknown[] = []
    for (const m of fresh) {
      const headers = (await (await fetch(`${mailpit}/api/v1/message/${m.ID}/headers`)).json()) as Record<string, string[]>
      const campaign = Number(headers['X-Campaign-Id']?.[0] ?? headers['X-Campaign-ID']?.[0])
      for (const to of m.To) {
        const bounce = /^bounce/i.test(to.Address)
        events.push({ email: to.Address, type: bounce ? 'hard' : 'delivered', at: m.Created, ...(bounce ? { reason: '550 5.1.1 stand-in: no such user' } : {}), ...(Number.isInteger(campaign) && campaign > 0 ? { campaign } : {}) })
      }
    }
    const res = await fetch(`${ctx.appUrl}/api/webhooks/email/smtp?s=${encodeURIComponent(webhookSecret)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }) })
    if (res.ok) for (const m of fresh) reported.add(m.ID)
    else console.warn(`[host] delivery report refused: ${res.status}`)
  }
  setInterval(() => void report().catch((err) => console.warn('[host] delivery report failed:', String(err))), 2000)
}

console.log(`[host] stand-in host on http://127.0.0.1:${port}, DNS on udp ${dnsPort} (${ctx.mode})`)
