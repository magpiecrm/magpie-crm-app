// Runs the sender health check (senderHealth.ts) against the live settings:
// every six hours in the background, and on demand from Settings →
// Prospecting. A newly blocklisted IP or domain raises a notification (bell
// and push), so an IP can be swapped out before verification quietly stops
// working.

import { promises as dns } from 'dns'
import { db } from '../db'
import { notify } from '../notify'
import { checkSenderHealth, newCriticalIssues, type HealthDeps, type HealthTarget, type SenderHealthReport } from './senderHealth'
import { getActiveVerifier, getProxyConfigs, type ReacherConfig } from './settings'

const INTERVAL_MS = 6 * 60 * 60_000
/** Let the app finish starting before the first run. */
const FIRST_RUN_DELAY_MS = 60_000

const empty = (err: any) => err?.code === 'ENOTFOUND' || err?.code === 'ENODATA'

const deps: HealthDeps = {
  resolve4: (name) => dns.resolve4(name).catch((err) => (empty(err) ? [] : Promise.reject(err))),
  resolveTxt: (name) => dns.resolveTxt(name).catch((err) => (empty(err) ? [] : Promise.reject(err))),
  resolveMx: (name) =>
    dns
      .resolveMx(name)
      .then((records) => records.map((r) => r.exchange).filter((h) => h && h !== '.'))
      .catch((err) => (empty(err) ? [] : Promise.reject(err))),
  reverse: (ip) => dns.reverse(ip).catch((err) => (empty(err) ? [] : Promise.reject(err))),
  // Only this server's own address is learned; nothing is sent.
  publicIp: async () => {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10_000) })
    const ip = (await res.text()).trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null
  },
  now: () => Date.now(),
}

/** Reacher's URL points at this machine (or a private network), so it connects out from this machine's IP. */
function isLocalHost(hostname: string): boolean {
  return (
    !hostname.includes('.') || // docker service name, e.g. "reacher"
    hostname === 'localhost' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) || // CGNAT, e.g. Tailscale
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.ts.net')
  )
}

/** The Reacher setup in use, or null when Reacher isn't verifying anything. */
function reacherInUse(): ReacherConfig | null {
  const active = getActiveVerifier()
  if (active?.provider === 'reacher') return active.reacher
  if (active?.provider === 'neverbounce') return active.fallback
  return null
}

function targetsFor(reacher: ReacherConfig): HealthTarget[] {
  const { proxies } = getProxyConfigs()
  if (proxies.length > 0) return proxies.map((p, i) => ({ label: p.label || `proxy-${i + 1}`, host: p.host }))
  let hostname = ''
  try {
    hostname = new URL(reacher.url).hostname
  } catch {
    // Invalid URL: fall through to this machine.
  }
  return hostname && !isLocalHost(hostname) ? [{ label: 'Reacher server', host: hostname }] : [{ label: 'This server', host: null }]
}

let running: Promise<SenderHealthReport | null> | null = null

/**
 * Checks the IPs and FROM domain Reacher verifies from, stores the report and
 * notifies about new critical problems. Null when Reacher isn't in use.
 */
export function runSenderHealthCheck(): Promise<SenderHealthReport | null> {
  running ??= (async () => {
    const reacher = reacherInUse()
    if (!reacher) return null
    const report = await checkSenderHealth(
      { targets: targetsFor(reacher), fromEmail: reacher.fromEmail ?? null, helloName: reacher.helloName ?? null },
      deps,
    )
    const fresh = newCriticalIssues(db.getSenderHealth(), report)
    db.saveSenderHealth(report)
    for (const message of fresh) notify('verifier_alert', `Email verification: ${message}`)
    console.log(`[SenderHealth] ${report.level}: ${report.ips.map((i) => `${i.label} ${i.level}`).join(', ')}`)
    return report
  })().finally(() => {
    running = null
  })
  return running
}

// globalThis so the timers survive Vite HMR, like the email scheduler.
const g = globalThis as any

export function startSenderHealthMonitor() {
  if (g.__senderHealthStarted) return
  g.__senderHealthStarted = true
  const run = () => runSenderHealthCheck().catch((err) => console.error('[SenderHealth] Check failed:', err?.message ?? err))
  setTimeout(run, FIRST_RUN_DELAY_MS)
  g.__senderHealthInterval = setInterval(run, INTERVAL_MS)
}
