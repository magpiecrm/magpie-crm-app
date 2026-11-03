// Inbox warmup, where the host offers it (hostRules.ts hostInboxWarmup): a
// sender whose inbox is connected (Settings → Reply detection) can warm in the
// host's warmup pool. The pool sends its warmup through the host's mail server,
// from the same IPs and with the same signatures as its campaigns, and files
// the warmup it receives away in that inbox.
//
// Switching it on sends the inbox's login to the host, which hands it to the
// pool's operator (Warmbly, run by Mindroot Ltd) and doesn't keep it; whoever
// switches it on agrees to that first (CONSENT_POINTS, recorded in
// warmup_consents). A new inbox password goes the same way. A sender's warmup
// lives with the host, so this asks it each time:
//
//   {REACHER_URL}/v1/inbox-warmup/*  (x-reacher-secret)  — the host's inboxWarmup.ts
//
// What this copy decides itself is whether a sender can warm yet: a ready
// sending domain, its own inbox connected and working, and SPF and DMARC
// records on its domain, which the pool needs.

import { resolveTxt } from 'node:dns/promises'
import { db } from './db'
import { env } from './env'
import { hostInboxWarmup } from './prospecting/hostRules'
import { canSendFrom } from './sendingDomains'
import type { PlacementTestResult, WarmupDay, WarmupPage, WarmupPlacement, WarmupSender, WarmupSenderRow } from '../features/settings/warmupTypes'

/** The wording agreed to before a sender's warmup starts; a new version means a new agreement. */
export const CONSENT_VERSION = '2026-11-03'
export const CONSENT_POINTS = [
  "Each day this sender exchanges a small number of ordinary-looking emails with other mailboxes in a warmup pool: about 10 a day at first, rising to about 40. They're sent through MagpieCRM's mail server, like your campaigns.",
  "The pool is run by Warmbly (Mindroot Ltd, UK). It's given this inbox's login and uses it to find the warmup mail in the inbox, move it out of spam, mark it read or important, file it in a folder called Warmbly, and delete it after 30 days. It doesn't keep your other mail, but the login lets it into the whole inbox.",
  "Some mail providers' terms don't allow automated mail like this, and warmup can't promise your email lands in the inbox.",
  'You can pause it or stop it at any time. Stopping takes the login out of the pool.',
]

type HostCall = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>

/** A request to the host's warmup service, with this copy's verification token. */
const hostApi: HostCall = async (method, path, body) => {
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  if (!url || !secret) throw new Error("Inbox warmup isn't set up on this server.")
  const res = await fetch(`${url}/v1/inbox-warmup${path}`, {
    method,
    headers: { 'x-reacher-secret': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A placement test sends its copies before it answers.
    signal: AbortSignal.timeout(path === '/placement-tests' && method === 'POST' ? 120_000 : 20_000),
  })
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) }
}

export interface WarmupDeps {
  host?: HostCall
  resolveTxt?: (name: string) => Promise<string[][]>
  now?: () => Date
}

async function ask<T>(deps: WarmupDeps, method: string, path: string, body?: unknown): Promise<T> {
  const { status, json } = await (deps.host ?? hostApi)(method, path, body)
  if (status < 200 || status > 299) throw new Error(typeof json?.error === 'string' ? json.error : `The warmup service answered ${status}.`)
  return json as T
}

const sender = (address: string) => `/senders/${encodeURIComponent(address.toLowerCase())}`

/** Whether the host offers inbox warmup to this copy. */
export const warmupOffered = () => hostInboxWarmup() !== null

/** Each domain's SPF and DMARC records, as last looked up (for 10 minutes). */
const dnsSeen = new Map<string, { at: number; spf: boolean; dmarc: boolean }>()

async function records(domain: string, deps: WarmupDeps) {
  const now = (deps.now?.() ?? new Date()).getTime()
  const seen = dnsSeen.get(domain)
  if (seen && now - seen.at < 10 * 60_000) return seen
  const txt = async (name: string) => ((await (deps.resolveTxt ?? resolveTxt)(name).catch(() => [])) as string[][]).map((r) => r.join(''))
  const spf = (await txt(domain)).some((r) => /^v=spf1\b/i.test(r.trim()))
  // A subdomain without its own DMARC record falls under its organisation's.
  const labels = domain.split('.')
  let dmarc = false
  for (const name of [`_dmarc.${domain}`, ...(labels.length > 2 ? [`_dmarc.${labels.slice(-2).join('.')}`] : [])]) {
    if ((await txt(name)).some((r) => /^v=DMARC1\b/i.test(r.trim()))) {
      dmarc = true
      break
    }
  }
  const found = { at: now, spf, dmarc }
  dnsSeen.set(domain, found)
  return found
}

/** Why each sender can't warm yet, in the order to fix them; empty for one that can. */
export async function eligibility(deps: WarmupDeps = {}): Promise<Array<Omit<WarmupSenderRow, 'warmup'>>> {
  const { inboxOf } = await import('./mailboxes')
  const rows: Array<Omit<WarmupSenderRow, 'warmup'>> = []
  for (const s of db.data.senders) {
    const email = s.email.toLowerCase()
    const domain = email.slice(email.lastIndexOf('@') + 1)
    const blockers: string[] = []
    if (!canSendFrom(email)) blockers.push(`${domain} isn't ready to send from yet: finish it under Settings → Sending.`)
    const inbox = inboxOf(s.id)
    if (!inbox) blockers.push("Connect this sender's inbox first, under Settings → Reply detection.")
    else if (inbox.record.user.trim().toLowerCase() !== email) blockers.push(`Its connected inbox is ${inbox.record.user}: warmup needs ${email}'s own inbox.`)
    else if (inbox.record.status !== 'ok' || !inbox.login) blockers.push("Its inbox login isn't working: reconnect it under Settings → Reply detection.")
    const dns = await records(domain, deps)
    if (!dns.spf) blockers.push(`${domain} has no SPF record. Add the one your mail provider gives you to its DNS.`)
    if (!dns.dmarc) blockers.push(`${domain} has no DMARC record. Add the one shown under Settings → Sending.`)
    rows.push({ senderId: s.id, name: s.name, email, blockers })
  }
  return rows
}

/** The Warmup page: each sender, whether it can warm, and its warmup from the host. */
export async function warmupPage(deps: WarmupDeps = {}): Promise<WarmupPage> {
  if (!warmupOffered()) return { offered: false }
  const senders = await eligibility(deps)
  const consent = { version: CONSENT_VERSION, points: CONSENT_POINTS }
  try {
    const view = await ask<any>(deps, 'GET', '')
    if (view?.available !== true) return { offered: false }
    const warming = new Map<string, WarmupSender>((view.senders as WarmupSender[]).map((w) => [w.address, w]))
    return {
      offered: true,
      stopped: view.stopped ?? null,
      maxSenders: view.maxSenders,
      senders: senders.map((s) => ({ ...s, warmup: warming.get(s.email) ?? null })),
      placementTests: view.placementTests,
      consent,
    }
  } catch (err: any) {
    const max = hostInboxWarmup()?.maxSenders ?? 3
    return { offered: true, stopped: null, maxSenders: max, senders: senders.map((s) => ({ ...s, warmup: null })), placementTests: { used: 0, limit: 0 }, consent, error: err?.message ?? String(err) }
  }
}

/** Starts a sender's warmup, once whoever is signed in has agreed to it. */
export async function startWarmup(senderId: number, agreedBy: string, deps: WarmupDeps = {}): Promise<WarmupSender> {
  if (!warmupOffered()) throw new Error("Inbox warmup isn't offered to this workspace.")
  const row = (await eligibility(deps)).find((s) => s.senderId === senderId)
  if (!row) throw new Error('Sender not found')
  if (row.blockers.length) throw new Error(row.blockers[0])
  const s = db.data.senders.find((x) => x.id === senderId)!
  const consent = { address: row.email, at: (deps.now?.() ?? new Date()).toISOString(), by: agreedBy, version: CONSENT_VERSION }
  const started = await sendInbox(senderId, s.name, consent, deps)
  db.mutate((d) => (d.warmup_consents = [...(d.warmup_consents ?? []).filter((c) => c.address !== row.email), consent]))
  return started
}

/** Hands the sender's inbox login to the host, with the consent it's warming under. */
async function sendInbox(senderId: number, name: string, consent: { address: string; by: string; version: string }, deps: WarmupDeps): Promise<WarmupSender> {
  const { inboxOf } = await import('./mailboxes')
  const login = inboxOf(senderId)?.login
  if (!login) throw new Error("Connect this sender's inbox first, under Settings → Reply detection.")
  return ask<WarmupSender>(deps, 'PUT', sender(consent.address), {
    name,
    imap: { host: login.host, port: login.port, secure: login.secure, user: login.user, password: login.password },
    consent: { version: consent.version, by: consent.by },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/**
 * A sender's inbox was connected again (Settings → Reply detection): if it's
 * warming, the pool gets the new login; if it was disconnected, warmup stops.
 */
export async function inboxChanged(senderId: number, connected: boolean, deps: WarmupDeps = {}): Promise<void> {
  if (!warmupOffered()) return
  const s = db.data.senders.find((x) => x.id === senderId)
  const consent = s && db.data.warmup_consents?.find((c) => c.address === s.email.toLowerCase())
  if (!s || !consent) return
  if (!connected) return stopWarmup(s.email, deps)
  await sendInbox(senderId, s.name, consent, deps)
}

export const pauseWarmup = (address: string, deps: WarmupDeps = {}) => ask<WarmupSender>(deps, 'POST', `${sender(address)}/pause`)
export const resumeWarmup = (address: string, deps: WarmupDeps = {}) => ask<WarmupSender>(deps, 'POST', `${sender(address)}/resume`)

/** Takes a sender out of warmup, and its login out of the pool. */
export async function stopWarmup(address: string, deps: WarmupDeps = {}): Promise<void> {
  const { status, json } = await (deps.host ?? hostApi)('DELETE', sender(address))
  if (status !== 204 && status !== 404) throw new Error(typeof json?.error === 'string' ? json.error : `The warmup service answered ${status}.`)
  db.mutate((d) => (d.warmup_consents = (d.warmup_consents ?? []).filter((c) => c.address !== address.toLowerCase())))
}

export async function warmupHistory(address: string, days: number, deps: WarmupDeps = {}): Promise<WarmupDay[]> {
  return (await ask<{ days: WarmupDay[] }>(deps, 'GET', `${sender(address)}/stats?days=${Math.min(Math.max(Math.round(days), 1), 90)}`)).days
}

export const warmupPlacement = (days: number, deps: WarmupDeps = {}) =>
  ask<WarmupPlacement>(deps, 'GET', `/placement?days=${Math.min(Math.max(Math.round(days), 1), 90)}`)

/** How each warming sender stands, by address, for warning before a campaign goes out from one in trouble. */
export async function warmupStanding(deps: WarmupDeps = {}): Promise<Record<string, Pick<WarmupSender, 'state' | 'health' | 'problem'>>> {
  if (!warmupOffered()) return {}
  const view = await ask<any>(deps, 'GET', '').catch(() => null)
  if (view?.available !== true) return {}
  return Object.fromEntries((view.senders as WarmupSender[]).map((w) => [w.address, { state: w.state, health: w.health, problem: w.problem }]))
}

/**
 * A placement test: the email, as a test renders it for a stand-in contact
 * (no lead's details reach the seed inboxes), sent from the sender to each of
 * the pool's seed inboxes through the host's mail server, to see where it lands.
 */
export async function startPlacementTest(
  email: { sender: { name: string; email: string }; subject: string; htmlContent: string; previewText?: string },
  deps: WarmupDeps = {},
): Promise<{ id: string; seeds: number }> {
  if (!warmupOffered()) throw new Error("Placement tests aren't available on this workspace.")
  if (!canSendFrom(email.sender.email)) throw new Error(`${email.sender.email} isn't on a sending domain that's ready yet.`)
  const { renderTestCopy } = await import('./emailService')
  const { subject, html } = await renderTestCopy(email, 'seed@placement.invalid', { first_name: 'Alex', last_name: 'Morgan', company: 'Acme' })
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return ask<{ id: string; seeds: number }>(deps, 'POST', '/placement-tests', { from: { name: email.sender.name, address: email.sender.email }, subject, html, text })
}

export const placementTestResult = (id: string, deps: WarmupDeps = {}) => ask<PlacementTestResult>(deps, 'GET', `/placement-tests/${encodeURIComponent(id)}`)
