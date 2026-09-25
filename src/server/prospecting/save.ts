// Save-to-list: the point where a search result becomes a stored contact.
//
// Email finding runs only here, only for the people the user chose. Saves of
// ten or fewer wait for the result (with a timeout); larger saves return a job
// id straight away and the client polls for progress. Jobs live in memory —
// they're progress reporting, not durable state, and a restart simply loses
// in-flight progress (contacts already saved stay saved).

import crypto from 'crypto'
import { resolveCompanyDomain } from './companies'
import { findEmail, type FinderDeps } from './emailFinder'
import { emailHash, hashesFor, isSuppressed, normaliseDomain, profileHash } from './suppression'
import type { CompanySource, EmailStatus, PersonResult } from './types'

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
  | 'retrying' // greylisted; will be retried
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
  source: CompanySource
  finder: FinderDeps
  db: typeof import('../db')['db']
  sleep?: (ms: number) => Promise<void>
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

async function resolveDomain(person: PersonResult, deps: SaveDeps): Promise<string | null> {
  if (person.companyDomain) return normaliseDomain(person.companyDomain)
  if (!person.companyRef) return null
  return resolveCompanyDomain(person.companyRef, person.company, deps.source, deps.db)
}

async function processPerson(
  person: PersonResult,
  listId: number,
  deps: SaveDeps,
  final: boolean,
): Promise<SaveOutcome> {
  const base = {
    profileUrl: person.profileUrl,
    name: `${person.firstName} ${person.lastName}`.trim(),
    company: person.company,
  }
  const suppressed = deps.db.getSuppressionHashes()

  const domain = await resolveDomain(person, deps)
  if (isSuppressed(hashesFor({ ...person, domain }), suppressed)) return { ...base, status: 'suppressed' }
  if (!domain) return { ...base, status: 'no_domain', message: 'Company website unknown — add the domain on the company first.' }

  const found = await findEmail(person, domain, deps.finder)
  if (found.greylisted && !final) return { ...base, status: 'retrying' }
  if (!found.email) return { ...base, status: 'not_found' }
  if (isSuppressed(hashesFor({ email: found.email }), suppressed)) return { ...base, status: 'suppressed' }

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
    source: person.source,
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

  const attempt = async (person: PersonResult, final: boolean) => {
    const i = indexOf.get(person.profileUrl)!
    try {
      job.outcomes[i] = await processPerson(person, job.listId, deps, final)
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
