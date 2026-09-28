// Health of the identity the verification server verifies from: each IP it connects from (the
// proxies, or the server itself) and the domain in its FROM address. Mail
// servers decide whether to answer a check by the same signals they use for
// incoming mail, so a blocklisted IP or a sender domain without SPF turns
// every answer into "unknown". This module finds those problems so an IP can
// be swapped out before it quietly stops working.
//
// DNS only: blocklist lookups (DNSBL), reverse DNS and SPF. Nothing about the
// people being prospected is involved.

type HealthLevel = 'ok' | 'warning' | 'critical' | 'unknown'

interface HealthIssue {
  level: Exclude<HealthLevel, 'ok'>
  /** Stable id, used to spot new problems between runs (for alerts). */
  code: string
  message: string
  fix?: string
}

interface IpHealth {
  label: string
  /** What the user configured: an IP or a hostname. */
  host: string
  ip: string | null
  ptr: string | null
  /** Blocklists the IP is on. */
  listedOn: string[]
  /** Blocklists that couldn't be queried this run. */
  unchecked: string[]
  issues: HealthIssue[]
  level: HealthLevel
}

interface DomainHealth {
  domain: string
  listedOn: string[]
  unchecked: string[]
  issues: HealthIssue[]
  level: HealthLevel
}

export interface SenderHealthReport {
  checked_at: string
  ips: IpHealth[]
  /** The FROM address's domain; null when no FROM address is set. */
  domain: DomainHealth | null
  /** Problems with the setup as a whole (e.g. no FROM address). */
  issues: HealthIssue[]
  level: HealthLevel
}

export interface HealthTarget {
  label: string
  /** IP or hostname. Null: this machine's public IP (no proxies). */
  host: string | null
}

export interface HealthDeps {
  /** A records; `[]` when the name doesn't exist. Throws when the lookup itself fails. */
  resolve4(name: string): Promise<string[]>
  resolveTxt(name: string): Promise<string[][]>
  /** MX hostnames; `[]` when there are none. */
  resolveMx(name: string): Promise<string[]>
  /** PTR names; `[]` when there are none. */
  reverse(ip: string): Promise<string[]>
  /** This machine's public IPv4 address. */
  publicIp(): Promise<string | null>
  now(): number
}

interface IpList {
  name: string
  zone: string
  /** Minor lists get a warning; major ones mean "replace this IP". */
  major: boolean
}

// Lists that mail servers commonly consult. SORBS closed in 2024.
const IP_LISTS: IpList[] = [
  { name: 'Spamhaus', zone: 'zen.spamhaus.org', major: true },
  { name: 'Barracuda', zone: 'b.barracudacentral.org', major: true },
  { name: 'SpamCop', zone: 'bl.spamcop.net', major: true },
  { name: 'UCEPROTECT', zone: 'dnsbl-1.uceprotect.net', major: false },
  { name: 'PSBL', zone: 'psbl.surriel.com', major: false },
]

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

const isIpv4 = (s: string) => IPV4_RE.test(s) && s.split('.').every((n) => Number(n) <= 255)
const reversed = (ip: string) => ip.split('.').reverse().join('.')
const sameHost = (a: string, b: string) => a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '')

/** 127.255.255.x is Spamhaus refusing the query (e.g. from a public DNS resolver), not a listing. */
const isRefusal = (code: string) => code.startsWith('127.255.255.')

/** Listing codes, `[]` when not listed, null when the list couldn't be queried. */
async function lookup(name: string, deps: HealthDeps): Promise<string[] | null> {
  try {
    const codes = await deps.resolve4(name)
    if (codes.some(isRefusal)) return null
    return codes.filter((c) => c.startsWith('127.'))
  } catch {
    return null
  }
}

/**
 * Spamhaus answers nothing (or a refusal code) to queries from public
 * resolvers like 8.8.8.8, which would read as "not listed". Its permanent
 * test entries tell a working lookup from a blocked one.
 */
async function spamhausReachable(deps: HealthDeps): Promise<{ ip: boolean; domain: boolean }> {
  const [ip, domain] = await Promise.all([lookup('2.0.0.127.zen.spamhaus.org', deps), lookup('dbltest.com.dbl.spamhaus.org', deps)])
  return { ip: Boolean(ip?.length), domain: Boolean(domain?.length) }
}

const SPAMHAUS_BLOCKED =
  "Spamhaus couldn't be checked: it refuses lookups from public DNS resolvers (Google, Cloudflare). Run this from a server using its own resolver."

function spamhausIssue(codes: string[]): HealthIssue {
  // Policy list only (127.0.0.10/11): a home or dynamic IP, not spam.
  if (codes.every((c) => c === '127.0.0.10' || c === '127.0.0.11')) {
    return {
      level: 'critical',
      code: 'spamhaus-pbl',
      message: "Spamhaus lists this as a home or dynamic IP, so many mail servers (Zoho, for one) refuse checks from it.",
      fix: 'Verify from a server or a proxy on a hosting provider instead.',
    }
  }
  return {
    level: 'critical',
    code: 'spamhaus',
    message: 'Listed on Spamhaus for spam or abuse. Most mail servers will refuse checks from it.',
    fix: 'Replace this IP. Delisting is possible, but a fresh IP is usually quicker.',
  }
}

/** Worst problem wins. "Couldn't check X" notes alone don't lower the level. */
function levelOf(issues: HealthIssue[]): HealthLevel {
  if (issues.some((i) => i.level === 'critical')) return 'critical'
  if (issues.some((i) => i.level === 'warning')) return 'warning'
  return 'ok'
}

async function resolveTargetIp(target: HealthTarget, deps: HealthDeps): Promise<string | null> {
  if (target.host === null) return deps.publicIp().catch(() => null)
  if (isIpv4(target.host)) return target.host
  try {
    return (await deps.resolve4(target.host))[0] ?? null
  } catch {
    return null
  }
}

async function checkIp(
  target: HealthTarget,
  helloName: string | null,
  spamhausOk: boolean,
  deps: HealthDeps,
): Promise<IpHealth> {
  const host = target.host ?? 'this server'
  const ip = await resolveTargetIp(target, deps)
  if (!ip) {
    const issue: HealthIssue = target.host
      ? { level: 'unknown', code: 'no-ip', message: `${target.host} doesn't resolve to an IPv4 address.`, fix: 'Check the proxy host.' }
      : { level: 'unknown', code: 'no-ip', message: "Couldn't find this server's public IP address." }
    return { label: target.label, host, ip: null, ptr: null, listedOn: [], unchecked: [], issues: [issue], level: 'unknown' }
  }

  const issues: HealthIssue[] = []
  const listedOn: string[] = []
  const unchecked: string[] = []

  const results = await Promise.all(
    IP_LISTS.map(async (list) => ({
      list,
      codes: list.name === 'Spamhaus' && !spamhausOk ? null : await lookup(`${reversed(ip)}.${list.zone}`, deps),
    })),
  )
  for (const { list, codes } of results) {
    if (codes === null) {
      unchecked.push(list.name)
      continue
    }
    if (codes.length === 0) continue
    listedOn.push(list.name)
    if (list.name === 'Spamhaus') issues.push(spamhausIssue(codes))
    else if (list.major) {
      issues.push({
        level: 'critical',
        code: `listed-${list.name.toLowerCase()}`,
        message: `Listed on ${list.name}. Mail servers that use it will refuse checks from this IP.`,
        fix: 'Replace this IP, or request delisting from the list.',
      })
    } else {
      issues.push({
        level: 'warning',
        code: `listed-${list.name.toLowerCase()}`,
        message: `Listed on ${list.name}, a smaller list few big mail providers use.`,
        fix: 'Watch the block rate; replace the IP if checks start failing.',
      })
    }
  }
  if (!spamhausOk) issues.push({ level: 'unknown', code: 'spamhaus-unreachable', message: SPAMHAUS_BLOCKED })

  // Reverse DNS: mail servers distrust IPs without one, or whose name doesn't
  // point back at the IP, and compare it with the HELO name.
  let ptr: string | null = null
  try {
    ptr = (await deps.reverse(ip))[0]?.replace(/\.$/, '') ?? null
  } catch {
    ptr = null
  }
  if (!ptr) {
    issues.push({
      level: 'warning',
      code: 'no-ptr',
      message: 'No reverse DNS. Many mail servers distrust IPs without one.',
      fix: helloName
        ? `Set this IP's reverse DNS to ${helloName} in your hosting provider's control panel.`
        : "Set this IP's reverse DNS in your hosting provider's control panel, and use the same name as the HELO name.",
    })
  } else {
    const forward = await deps.resolve4(ptr).catch(() => [] as string[])
    if (!forward.includes(ip)) {
      issues.push({
        level: 'warning',
        code: 'ptr-mismatch',
        message: `Reverse DNS says ${ptr}, but ${ptr} doesn't point back to ${ip}.`,
        fix: `Add an A record: ${ptr} → ${ip}.`,
      })
    }
    if (helloName && !sameHost(ptr, helloName)) {
      issues.push({
        level: 'warning',
        code: 'helo-mismatch',
        message: `The HELO name (${helloName}) doesn't match this IP's reverse DNS (${ptr}).`,
        fix: `Set the reverse DNS to ${helloName}, or change the HELO name to ${ptr}.`,
      })
    }
  }

  return { label: target.label, host, ip, ptr, listedOn, unchecked, issues, level: levelOf(issues) }
}

// --- SPF --------------------------------------------------------------------
// Enough of RFC 7208 to answer "may this IP send as this domain?": ip4, a,
// mx, include, redirect and all. ip6/exists/ptr never match here. Capped at
// SPF's own limit of 10 DNS lookups.

type SpfResult = 'pass' | 'fail' | 'none' | 'error'

const ipToInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0

function inCidr(ip: string, base: string, bits: number): boolean {
  if (!isIpv4(base) || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask)
}

async function spfRecord(domain: string, deps: HealthDeps): Promise<string | null> {
  const records = await deps.resolveTxt(domain)
  const spf = records.map((chunks) => chunks.join('')).find((r) => /^v=spf1(\s|$)/i.test(r.trim()))
  return spf?.trim() ?? null
}

async function evaluateSpf(domain: string, ip: string, deps: HealthDeps, budget = { lookups: 0 }): Promise<SpfResult> {
  if (++budget.lookups > 10) return 'error'
  let record: string | null
  try {
    record = await spfRecord(domain, deps)
  } catch {
    return 'error'
  }
  if (!record) return 'none'

  let redirect: string | null = null
  for (const term of record.split(/\s+/).slice(1)) {
    const lower = term.toLowerCase()
    if (lower.startsWith('redirect=')) {
      redirect = term.slice('redirect='.length)
      continue
    }
    const qualifier = /^[+\-~?]/.test(term) ? term[0] : '+'
    const body = /^[+\-~?]/.test(term) ? term.slice(1) : term
    const [mech, ...rest] = body.split(':')
    const arg = rest.join(':')
    const verdict = (): SpfResult => (qualifier === '+' ? 'pass' : 'fail')

    switch (mech.toLowerCase()) {
      case 'all':
        return verdict()
      case 'ip4': {
        const [base, bits] = arg.split('/')
        if (inCidr(ip, base, bits === undefined ? 32 : Number(bits))) return verdict()
        break
      }
      case 'a':
      case 'mx': {
        if (++budget.lookups > 10) return 'error'
        const [target, bits] = (arg || domain).split('/')
        const cidr = bits === undefined ? 32 : Number(bits)
        const hosts = mech.toLowerCase() === 'a' ? [target] : await deps.resolveMx(target).catch(() => [] as string[])
        for (const h of hosts) {
          const addrs = await deps.resolve4(h).catch(() => [] as string[])
          if (addrs.some((a) => inCidr(ip, a, cidr))) return verdict()
        }
        break
      }
      case 'include': {
        const inner = await evaluateSpf(arg, ip, deps, budget)
        if (inner === 'error') return 'error'
        if (inner === 'pass') return verdict()
        break
      }
      default:
        // a/mx with a CIDR suffix and no colon ("a/24", "mx/24").
        if (/^(a|mx)\/\d+$/i.test(body)) {
          const [m, bits] = body.split('/')
          const hosts = m.toLowerCase() === 'a' ? [domain] : await deps.resolveMx(domain).catch(() => [] as string[])
          for (const h of hosts) {
            const addrs = await deps.resolve4(h).catch(() => [] as string[])
            if (addrs.some((a) => inCidr(ip, a, Number(bits)))) return verdict()
          }
        }
    }
  }
  return redirect ? evaluateSpf(redirect, ip, deps, budget) : 'fail'
}

async function checkDomain(domain: string, ips: IpHealth[], spamhausOk: boolean, deps: HealthDeps): Promise<DomainHealth> {
  const issues: HealthIssue[] = []
  const listedOn: string[] = []
  const unchecked: string[] = []

  if (spamhausOk) {
    const codes = await lookup(`${domain}.dbl.spamhaus.org`, deps)
    if (codes === null) unchecked.push('Spamhaus DBL')
    else if (codes.length > 0) {
      listedOn.push('Spamhaus DBL')
      issues.push({
        level: 'critical',
        code: 'dbl',
        message: `${domain} is on the Spamhaus domain blocklist. Mail servers will refuse checks that use it as the sender.`,
        fix: 'Use a different domain for the FROM address.',
      })
    }
  } else {
    unchecked.push('Spamhaus DBL')
  }

  const mx = await deps.resolveMx(domain).catch(() => null)
  if (mx && mx.length === 0) {
    issues.push({
      level: 'warning',
      code: 'no-mx',
      message: `${domain} has no MX record. Some mail servers check that the sender's domain can receive mail.`,
      fix: `Add an MX record for ${domain} (any mailbox provider will do).`,
    })
  }

  for (const target of ips) {
    if (!target.ip) continue
    const spf = await evaluateSpf(domain, target.ip, deps)
    if (spf === 'none') {
      issues.push({
        level: 'warning',
        code: 'no-spf',
        message: `${domain} has no SPF record, so servers like Mimecast may reject it as a sender.`,
        fix: `Add a TXT record on ${domain}: v=spf1 ip4:${target.ip} ~all`,
      })
      break
    }
    if (spf === 'fail') {
      issues.push({
        level: 'warning',
        code: `spf-${target.ip}`,
        message: `${domain}'s SPF record doesn't allow ${target.label} (${target.ip}) to send as it.`,
        fix: `Add ip4:${target.ip} to ${domain}'s SPF record.`,
      })
    } else if (spf === 'error') {
      issues.push({
        level: 'unknown',
        code: 'spf-error',
        message: `Couldn't evaluate ${domain}'s SPF record (DNS error or more than 10 lookups).`,
      })
      break
    }
  }

  return { domain, listedOn, unchecked, issues, level: levelOf(issues) }
}

export interface HealthInput {
  targets: HealthTarget[]
  fromEmail: string | null
  helloName: string | null
}

export async function checkSenderHealth(input: HealthInput, deps: HealthDeps): Promise<SenderHealthReport> {
  const spamhaus = await spamhausReachable(deps)
  const ips = await Promise.all(input.targets.map((t) => checkIp(t, input.helloName, spamhaus.ip, deps)))

  const fromDomain = input.fromEmail?.split('@')[1]?.toLowerCase().trim() || null
  const domain = fromDomain ? await checkDomain(fromDomain, ips, spamhaus.domain, deps) : null

  const issues: HealthIssue[] = []
  if (!fromDomain) {
    issues.push({
      level: 'warning',
      code: 'no-from',
      message: "No FROM address is set, so the verification server uses its default gmail.com sender. Mimecast and others reject it from a non-Google IP.",
      fix: 'Set a FROM address on a domain you own (not your campaign sending domain).',
    })
  }
  if (!input.helloName) {
    issues.push({
      level: 'warning',
      code: 'no-helo',
      message: "No HELO name is set, so the verification server introduces itself with a default name that doesn't match its IP.",
      fix: "Set the HELO name to the verifying IP's reverse DNS name.",
    })
  }

  const worst = levelOf([...issues, ...ips.flatMap((i) => i.issues), ...(domain?.issues ?? [])])
  // Nothing could be looked up at all (e.g. no network): say so rather than "ok".
  const level: HealthLevel = worst === 'ok' && ips.length > 0 && ips.every((i) => i.level === 'unknown') ? 'unknown' : worst

  return { checked_at: new Date(deps.now()).toISOString(), ips, domain, issues, level }
}

/**
 * Critical problems in `next` that weren't in `previous`, for alerts: only a
 * change is worth a notification, not the same listing every six hours.
 */
export function newCriticalIssues(previous: SenderHealthReport | null, next: SenderHealthReport): string[] {
  const keys = (r: SenderHealthReport | null) => {
    const out = new Map<string, string>()
    if (!r) return out
    for (const ip of r.ips) {
      for (const i of ip.issues) {
        if (i.level === 'critical') out.set(`${ip.host}:${i.code}`, `${ip.label}${ip.ip ? ` (${ip.ip})` : ''}: ${i.message}`)
      }
    }
    for (const i of r.domain?.issues ?? []) {
      if (i.level === 'critical') out.set(`${r.domain!.domain}:${i.code}`, i.message)
    }
    return out
  }
  const before = keys(previous)
  return [...keys(next)].filter(([k]) => !before.has(k)).map(([, message]) => message)
}
