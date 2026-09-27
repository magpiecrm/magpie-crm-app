// Sending domains, for a copy whose email is sent by its host through the
// host's Amazon SES account (SENDING_MANAGED=on, with the SES_* settings).
// Users can't choose a provider or enter credentials; they add the domains
// they send from and put the DNS records shown here on them:
//
// - SES's three DKIM CNAMEs, which verify the domain in SES and sign mail.
// - A TXT record with this copy's own token. The host's SES account is shared
//   by every copy it runs, so SES verifying a domain for one of them mustn't
//   let another send as it: each copy only sends from domains whose owner put
//   *its* token in DNS.
//
// Mail can only come from an address at a domain that's verified both ways
// (or a subdomain of one). Removing a domain here doesn't touch SES, where
// another of the owner's copies may still use it.

import crypto from 'crypto'
import dns from 'dns/promises'
import { db } from './db'
import { env } from './env'
import { signRequest } from './providers/sigv4'

export interface SendingDomain {
  domain: string
  /** Proves this copy's owner controls the domain (the _magpiecrm TXT record). */
  ownershipToken: string
  dkimTokens: string[]
  /** From SES: whether it will send from this domain. */
  sesVerified: boolean
  /** SES's DKIM status: PENDING, SUCCESS, FAILED, TEMPORARY_FAILURE, NOT_STARTED. */
  dkimStatus: string
  ownershipVerified: boolean
  addedAt: string
  checkedAt: string | null
}

export interface DnsRecord {
  type: 'CNAME' | 'TXT'
  name: string
  value: string
  purpose: string
  /** Recommended rather than required. */
  optional?: boolean
}

const OWNERSHIP_LABEL = '_magpiecrm'
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** "Acme.com", "https://acme.com/", "jo@acme.com" → "acme.com"; null if it isn't a domain. */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^.*@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
  return DOMAIN.test(d) ? d : null
}

function sesConfig() {
  const accessKeyId = env.ses.accessKeyId()
  const secretAccessKey = env.ses.secretAccessKey()
  if (!accessKeyId || !secretAccessKey) throw new Error('Sending isn\'t set up on this server yet.')
  return { region: env.ses.region() || 'us-east-1', accessKeyId, secretAccessKey }
}

interface SesApi {
  (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }>
}

/** A signed SESv2 request with the host's credentials. */
const sesApi: SesApi = async (method, path, body) => {
  const { region, accessKeyId, secretAccessKey } = sesConfig()
  const host = `email.${region}.amazonaws.com`
  const payload = body === undefined ? '' : JSON.stringify(body)
  const headers = signRequest({ method, host, path, region, service: 'ses', body: payload, accessKeyId, secretAccessKey })
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers,
    body: method === 'POST' ? payload : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

type TxtLookup = (name: string) => Promise<string[][]>

export interface SendingDomainDeps {
  ses?: SesApi
  resolveTxt?: TxtLookup
  now?: () => Date
}

const list = (): SendingDomain[] => db.getSendingDomains()

export function getSendingDomains(): SendingDomain[] {
  return list()
}

/** The records to add to the domain's DNS. */
export function dnsRecords(d: SendingDomain): DnsRecord[] {
  return [
    ...d.dkimTokens.map(
      (t): DnsRecord => ({
        type: 'CNAME',
        name: `${t}._domainkey.${d.domain}`,
        value: `${t}.dkim.amazonses.com`,
        purpose: 'Signs your email (DKIM) and verifies the domain for sending',
      }),
    ),
    {
      type: 'TXT',
      name: `${OWNERSHIP_LABEL}.${d.domain}`,
      value: `magpiecrm-verification=${d.ownershipToken}`,
      purpose: 'Shows this workspace owns the domain',
    },
    {
      type: 'TXT',
      name: `_dmarc.${d.domain}`,
      value: 'v=DMARC1; p=none;',
      purpose: "Tells inboxes what to do with mail that fails checks; skip it if you have one already",
      optional: true,
    },
  ]
}

async function lookUp(d: SendingDomain, deps: SendingDomainDeps): Promise<SendingDomain> {
  const ses = deps.ses ?? sesApi
  const resolveTxt = deps.resolveTxt ?? dns.resolveTxt
  const { status, json } = await ses('GET', `/v2/email/identities/${d.domain}`)
  if (status !== 200) throw new Error(json?.message ?? `The sending service answered ${status}`)
  const txt = await resolveTxt(`${OWNERSHIP_LABEL}.${d.domain}`).catch(() => [] as string[][])
  return {
    ...d,
    dkimTokens: json?.DkimAttributes?.Tokens ?? d.dkimTokens,
    dkimStatus: json?.DkimAttributes?.Status ?? 'NOT_STARTED',
    sesVerified: json?.VerifiedForSendingStatus === true,
    ownershipVerified: txt.some((parts) => parts.join('') === `magpiecrm-verification=${d.ownershipToken}`),
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
  }
}

function save(next: SendingDomain) {
  db.saveSendingDomains([...list().filter((d) => d.domain !== next.domain), next].sort((a, b) => a.domain.localeCompare(b.domain)))
}

/** Adds a domain in SES (or picks up the one already there) and returns it with its records. */
export async function addSendingDomain(input: string, deps: SendingDomainDeps = {}): Promise<SendingDomain> {
  const domain = normalizeDomain(input)
  if (!domain) throw new Error('Enter a domain you own, like acme.com.')
  const existing = list().find((d) => d.domain === domain)
  if (existing) return existing

  const ses = deps.ses ?? sesApi
  const configurationSet = env.ses.configurationSet()
  const created = await ses('POST', '/v2/email/identities', {
    EmailIdentity: domain,
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
  })
  // Already in the host's SES account (added before, or by another copy): the
  // ownership record still has to be added for this copy.
  if (created.status !== 200 && created.status !== 409) {
    throw new Error(created.json?.message ?? `The sending service answered ${created.status}`)
  }
  const fresh: SendingDomain = {
    domain,
    ownershipToken: crypto.randomBytes(16).toString('hex'),
    dkimTokens: created.json?.DkimAttributes?.Tokens ?? [],
    sesVerified: false,
    dkimStatus: 'PENDING',
    ownershipVerified: false,
    addedAt: (deps.now?.() ?? new Date()).toISOString(),
    checkedAt: null,
  }
  const checked = await lookUp(fresh, deps).catch(() => fresh)
  save(checked)
  return checked
}

/** Checks SES and DNS again for one domain. */
export async function checkSendingDomain(domain: string, deps: SendingDomainDeps = {}): Promise<SendingDomain> {
  const d = list().find((x) => x.domain === domain)
  if (!d) throw new Error(`${domain} isn't one of your sending domains.`)
  const checked = await lookUp(d, deps)
  save(checked)
  return checked
}

export function removeSendingDomain(domain: string) {
  db.saveSendingDomains(list().filter((d) => d.domain !== domain))
}

export const isReady = (d: SendingDomain) => d.sesVerified && d.ownershipVerified

/** The address in "Name <jo@acme.com>" or "jo@acme.com". */
const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase()

/** Whether mail may come from this address: its domain, or a parent of it, is verified both ways. */
export function canSendFrom(from: string): boolean {
  const domain = addressOf(from).split('@')[1]
  if (!domain) return false
  return list().some((d) => isReady(d) && (domain === d.domain || domain.endsWith(`.${d.domain}`)))
}

/** Throws unless mail may come from this address (only when the host runs sending). */
export function requireSendingDomain(from: string) {
  if (!env.sendingManaged() || canSendFrom(from)) return
  const domain = addressOf(from).split('@')[1] ?? from
  throw new Error(`${domain} isn't a verified sending domain yet. Add it in Settings → Sending and put its DNS records in place.`)
}
