// Save-to-list: the point where a search result becomes a stored contact.
//
// Email finding runs only here, only for the people the user chose. Saves of
// ten or fewer wait for the result (with a timeout); larger saves return a job
// id straight away and the client polls for progress. Jobs live in memory —
// they're progress reporting, not durable state, and a restart simply loses
// in-flight progress (contacts already saved stay saved).

import { refineFromProfile } from './refine'
import crypto from 'crypto'
import { domainForPerson } from './companies'
import { findEmailCounted, type FinderDeps } from './emailFinder'
import { isPacing } from './proxyRouter'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'
import { handsOver, ProfileUnconfirmed, type CompanySource, type EmailStatus, type LookupOutcome, type PeopleSource, type PersonResult } from './types'
import { recordLookup, recordUsage } from '../usage'
import { remaining } from '../allowance'
import { rememberIfUnverifiable } from './unverifiable'

const SYNC_LIMIT = 10
const SYNC_TIMEOUT_MS = 45_000
const CONCURRENCY = 3
/** Greylisting servers ask to be retried after a few minutes. */
const GREYLIST_RETRY_MS = 5 * 60_000
const JOB_TTL_MS = 60 * 60_000

export type SaveStatus =
  | 'pending' // queued, not processed yet
  | 'saved' // new contact created
  | 'already_saved' // contact existed; added to the list, nothing else changed
  | 'suppressed' // on the global suppression list
  | 'no_domain' // company website unknown
  | 'not_found' // no deliverable address
  | 'unconfirmed' // a likely address, but not verified, so not saved
  | 'retrying' // greylisted; will be retried
  | 'limit' // the plan's email reveals for this month are used up
  | 'error'

interface SaveOutcome {
  profileUrl: string
  name: string
  company: string
  status: SaveStatus
  email?: string
  emailStatus?: EmailStatus
  message?: string
}

export interface ProspectJob {
  id: string
  status: 'running' | 'done' | 'failed'
  listId: number
  total: number
  processed: number
  outcomes: SaveOutcome[]
  error?: string
  createdAt: string
  finishedAt?: string
}

export interface SaveDeps {
  source: CompanySource & PeopleSource
  finder: FinderDeps
  db: typeof import('../db')['db']
  sleep?: (ms: number) => Promise<void>
  /** Only save emails the mail server confirmed. Defaults to true. */
  verifiedOnly?: boolean
  /** With `verifiedOnly`, still save `format_confirmed` guesses. */
  allowFormatConfirmed?: boolean
  /** Passes a newly saved contact to the host's shared database, in a hosted copy that contributes (sharedPeople.ts). */
  contribute?: (person: PersonResult, email: string, status: EmailStatus) => void
  /** Gives the email of someone held in that database (sharedPeople.ts sharedEmail). */
  sharedEmail?: (handle: string) => Promise<{ email: string; free: boolean } | null>
  /** This copy contributes to that database, so its emails are free. */
  sharedFree?: boolean
}

const jobs = new Map<string, ProspectJob>()

function prune() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.finishedAt && new Date(job.finishedAt).getTime() < cutoff) jobs.delete(id)
  }
}

export function getJob(id: string): ProspectJob | null {
  const job = jobs.get(id)
  return job ? structuredClone(job) : null
}

/**
 * Search results don't say where someone works, so anyone without a known
 * employer gets one profile lookup (3 credits) at save time. The profile's
 * current position is also a better title than the search headline.
 */
async function withEmployer(person: PersonResult, deps: SaveDeps, gate: LookupGate): Promise<PersonResult> {
  // Already known, or already paid for during search.
  if (person.companyDomain || person.companyRef || person.profileChecked) return person
  // Only the first lookup in a job runs blind; the rest wait for it and are
  // skipped only if the lookup itself failed (no credits, API down). A
  // profile without a company page is normal and doesn't stop the others.
  if (gate.first) {
    if (!(await gate.first)) return person
  }
  const lookup = deps.source.getPerson(person.profileUrl)
  // A profile that couldn't be confirmed says nothing about the rest.
  gate.first ??= lookup.then(
    () => true,
    (err) => err instanceof ProfileUnconfirmed,
  )
  try {
    return refineFromProfile(person, await lookup) ?? person
  } catch (err) {
    if (err instanceof ProfileUnconfirmed) return person
    throw err
  }
}

interface LookupGate {
  first: Promise<boolean> | null
}

function resolveDomain(person: PersonResult, deps: SaveDeps): Promise<string | null> {
  return domainForPerson(person, deps.source, deps.db)
}

async function processPerson(
  searched: PersonResult,
  listId: number,
  deps: SaveDeps,
  final: boolean,
  gate: LookupGate,
): Promise<SaveOutcome> {
  // Opted-out people are skipped before anything is spent on them.
  if (isSuppressed(hashesFor(searched), deps.db.getSuppressionHashes())) {
    return {
      profileUrl: searched.profileUrl,
      name: `${searched.firstName} ${searched.lastName}`.trim(),
      company: searched.company,
      status: 'suppressed',
    }
  }
  // Already revealed: reuse that address rather than finding it again.
  const person = searched.email ? searched : await withEmployer(searched, deps, gate)
  const base = {
    profileUrl: person.profileUrl,
    name: `${person.firstName} ${person.lastName}`.trim(),
    company: person.company,
  }
  const suppressed = deps.db.getSuppressionHashes()

  // Held in the host's shared database: it gives the address it verified, free
  // to a copy that contributes. If it can't, the address is found as usual.
  const held =
    !person.email && person.shared && deps.sharedEmail && (deps.sharedFree || remaining('reveals') >= 1) ? await deps.sharedEmail(person.shared) : null

  let found: { email: string | null; status: EmailStatus; greylisted: boolean; detail?: string; reason?: string; outcome?: LookupOutcome }
  if (person.email) {
    found = { email: person.email.toLowerCase().trim(), status: person.emailStatus ?? 'unverified', greylisted: false }
  } else if (held) {
    found = { email: held.email, status: 'verified', greylisted: false }
  } else {
    // Finding a new address uses one of the plan's email reveals.
    if (remaining('reveals') < 1) {
      return { ...base, status: 'limit', message: "Your plan's email reveals for this month are used up. Upgrade to get more." }
    }
    const domain = await resolveDomain(person, deps)
    if (isSuppressed(hashesFor({ ...person, domain }), suppressed)) return { ...base, status: 'suppressed' }
    if (!domain) {
      recordLookup('noDomain')
      return {
        ...base,
        status: 'no_domain',
        message: person.companyRef
          ? 'Company website unknown. Add the domain on the company first.'
          : "Couldn't find where they currently work, so there's no email domain.",
      }
    }
    const headcount = person.companyRef ? deps.db.getProspectCompany(person.companyRef)?.headcount : null
    try {
      found = await findEmailCounted(person, domain, deps.finder, { headcount })
    } catch (err) {
      // Held back only by pacing: tried again at the end, like a greylisted check.
      if (isPacing(err) && !final) return { ...base, status: 'retrying' }
      throw err
    }
    recordUsage({ emailLookups: 1 })
  }
  if (found.greylisted && !final) return { ...base, status: 'retrying' }
  // Counted once it's final: a greylisted first try is retried at the end.
  if (found.outcome) recordLookup(found.outcome)
  // Nothing handed over, for a reason no retry changes: remembered, so later
  // searches can leave them out (unverifiable.ts).
  if (found.outcome && (!found.email || !handsOver(found.status, deps))) {
    rememberIfUnverifiable(person.profileUrl, found.outcome, deps.db)
  }
  if (found.email && !handsOver(found.status, deps)) {
    return { ...base, status: 'unconfirmed', message: found.reason ?? found.detail }
  }
  if (!found.email) return { ...base, status: 'not_found', message: found.detail }
  const emailDomain = found.email.split('@')[1]
  if (isSuppressed(hashesFor({ email: found.email, firstName: person.firstName, lastName: person.lastName, domain: emailDomain }), suppressed)) {
    return { ...base, status: 'suppressed' }
  }

  const existing = deps.db.getContact(found.email)
  deps.db.upsertContact(
    found.email,
    existing
      ? {}
      : { builtin: { first_name: person.firstName, last_name: person.lastName, job_title: person.title, company: person.company } },
    { create: true },
  )
  deps.db.addContactToList(listId, found.email)

  if (existing) {
    return { ...base, status: 'already_saved', email: found.email, emailStatus: existing.email_status ?? found.status }
  }

  deps.db.setContactProspectFields(found.email, {
    // `shared`: the email came from the host's shared database, so this contact is never contributed back to it.
    source: held ? 'shared' : person.source,
    email_status: found.status,
    notice_status: 'pending',
  })
  deps.db.addDisclosure({
    contact_hash: emailHash(found.email),
    profile_hash: profileHash(person.profileUrl),
    sources: [person.source],
    event: 'saved',
    notice_status: 'pending',
  })
  // A revealed address was already counted as found when it was revealed.
  recordUsage({ contactsSaved: 1, ...(person.email ? {} : held?.free ? { sharedEmails: 1 } : { emailsFound: 1 }) })
  deps.contribute?.(person, found.email, found.status)
  return { ...base, status: 'saved', email: found.email, emailStatus: found.status }
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

async function runJob(job: ProspectJob, people: PersonResult[], deps: SaveDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const indexOf = new Map(people.map((p, i) => [p.profileUrl, i]))
  const gate: LookupGate = { first: null }

  const attempt = async (person: PersonResult, final: boolean) => {
    const i = indexOf.get(person.profileUrl)!
    try {
      job.outcomes[i] = await processPerson(person, job.listId, deps, final, gate)
    } catch (err: any) {
      job.outcomes[i] = {
        profileUrl: person.profileUrl,
        name: `${person.firstName} ${person.lastName}`.trim(),
        company: person.company,
        status: 'error',
        message: String(err?.message ?? err),
      }
    }
  }

  try {
    await runPool(people, CONCURRENCY, async (p) => {
      await attempt(p, false)
      if (job.outcomes[indexOf.get(p.profileUrl)!]?.status !== 'retrying') job.processed++
    })

    const retry = people.filter((p) => job.outcomes[indexOf.get(p.profileUrl)!]?.status === 'retrying')
    if (retry.length > 0) {
      await sleep(GREYLIST_RETRY_MS)
      await runPool(retry, CONCURRENCY, async (p) => {
        await attempt(p, true)
        job.processed++
      })
    }
    job.status = 'done'
  } catch (err: any) {
    job.status = 'failed'
    job.error = String(err?.message ?? err)
  } finally {
    job.finishedAt = new Date().toISOString()
    const counts = job.outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1
      return acc
    }, {})
    // Counts only; outcomes carry names and addresses.
    console.log(`[Prospecting] Save job ${job.id} ${job.status}: ${JSON.stringify(counts)}`)
  }
}

/**
 * Starts a save. Resolves with the finished job for small saves (unless they
 * hit the timeout), otherwise with the running job for the client to poll.
 */
export async function saveProspects(listId: number, people: PersonResult[], deps: SaveDeps): Promise<ProspectJob> {
  prune()
  // Dedupe by profile URL within the request.
  const unique = [...new Map(people.map((p) => [p.profileUrl, p])).values()]

  const job: ProspectJob = {
    id: crypto.randomUUID(),
    status: 'running',
    listId,
    total: unique.length,
    processed: 0,
    outcomes: unique.map((p) => ({
      profileUrl: p.profileUrl,
      name: `${p.firstName} ${p.lastName}`.trim(),
      company: p.company,
      status: 'pending' as const,
    })),
    createdAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)

  const done = runJob(job, unique, deps)
  if (unique.length <= SYNC_LIMIT) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([done, new Promise((r) => (timer = setTimeout(r, SYNC_TIMEOUT_MS)))])
    clearTimeout(timer)
  }
  return structuredClone(job)
}
