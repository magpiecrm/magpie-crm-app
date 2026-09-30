import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinderDeps } from './emailFinder'
import type { CompanySource, PeopleSource, PersonResult } from './types'

// End-to-end save and opt-out against an in-memory stand-in for the JSON db,
// a fake SocialFetch company source and a fake verification server. Nothing touches the
// network or disk.

type Contact = {
  email: string; first_name: string; last_name: string; job_title: string; company: string; status: string
  created_at: string; source?: string; email_status?: string; notice_status?: string
}

const state = {
  unverifiable: [] as any[],
  contacts: [] as Contact[],
  list_contacts: [] as Array<{ list_id: number; contact_email: string }>,
  companies: [] as Array<{ ref: string; name: string; domain: string | null; domain_source: string; page_checked?: boolean }>,
  suppression: [] as Array<{ hash: string; kind: string }>,
  disclosure: [] as any[],
}

let allowance: any = null
const fakeDb = {
  getAllowance: () => allowance,
  getUnverifiable: () => state.unverifiable,
  setUnverifiable: (entries: any[]) => (state.unverifiable = entries),
  get data() {
    return { contacts: state.contacts, lists: [{ id: 1, name: 'Leads' }] }
  },
  getProspectCompany: (ref: string) => state.companies.find((c) => c.ref === ref) ?? null,
  upsertProspectCompanies: (entries: any[]) => {
    for (const e of entries) {
      const i = state.companies.findIndex((c) => c.ref === e.ref)
      if (i >= 0) state.companies[i] = { ...state.companies[i], ...e }
      else state.companies.push(e)
    }
  },
  getSuppressionHashes: () => new Set(state.suppression.map((s) => s.hash)),
  addSuppression: (entries: any[]) => {
    for (const e of entries) if (!state.suppression.some((s) => s.hash === e.hash)) state.suppression.push(e)
  },
  getContact: (email: string) => state.contacts.find((c) => c.email === email.toLowerCase()) ?? null,
  upsertContact: (email: string, patch: any) => {
    let c = fakeDb.getContact(email)
    if (!c) {
      c = { email: email.toLowerCase(), first_name: '', last_name: '', job_title: '', company: '', status: 'subscribed', created_at: '' }
      state.contacts.push(c)
    }
    Object.assign(c, patch.builtin ?? {})
    return { contact: c, created: true }
  },
  addContactToList: (listId: number, email: string) => state.list_contacts.push({ list_id: listId, contact_email: email }),
  setContactProspectFields: (email: string, patch: any) => Object.assign(fakeDb.getContact(email)!, patch),
  addDisclosure: (entry: any) => state.disclosure.push(entry),
  getDisclosures: () => state.disclosure,
}

vi.mock('../db', () => ({ db: fakeDb }))
// How each lookup ended, as counted for the hit rate.
const lookups: string[] = []
vi.mock('../usage', () => ({ recordUsage: () => {}, recordLookup: (outcome: string) => lookups.push(outcome), recordLimit: () => {} }))
vi.mock('../emailService', () => ({
  deleteContacts: async (emails: string[]) => {
    state.contacts = state.contacts.filter((c) => !emails.includes(c.email))
    state.list_contacts = state.list_contacts.filter((l) => !emails.includes(l.contact_email))
  },
}))

const { VerificationLimitError } = await import('./proxyRouter')
const { saveProspects } = await import('./save')
const { processOptOut, hashesFor } = await import('./suppression')

const person = (first: string, last: string, over: Partial<PersonResult> = {}): PersonResult => ({
  profileUrl: `https://www.linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`,
  firstName: first,
  lastName: last,
  title: 'Head of Marketing',
  seniority: 'head',
  company: 'Acme',
  companyRef: '1',
  companyDomain: null,
  country: 'United Kingdom',
  source: 'socialfetch',
  ...over,
})

const source: CompanySource & PeopleSource = {
  searchCompanies: async () => ({ items: [], nextCursor: null, reportedTotal: null, warnings: [] }),
  searchPeople: async () => ({ items: [], nextCursor: null, reportedTotal: null, warnings: [] }),
  // Profile lookups: /in/kim-park has a listed employer (company ref 1);
  // /in/jo-bloggs works somewhere without a company page.
  getPerson: vi.fn(async (ref: string) =>
    ref.endsWith('/in/kim-park')
      ? {
          profileUrl: ref, firstName: 'Kim', lastName: 'Park', title: 'Head of Data', seniority: 'head' as const,
          company: 'Acme', companyRef: '1', companyDomain: null, country: 'United Kingdom', source: 'socialfetch' as const,
        }
      : ref.endsWith('/in/jo-bloggs')
        ? {
            profileUrl: ref, firstName: 'Jo', lastName: 'Bloggs', title: 'Founder', seniority: 'owner' as const,
            company: 'Bloggs Ltd', companyRef: null, companyDomain: null, country: 'United Kingdom', source: 'socialfetch' as const,
          }
        : null,
  ),
  getCompany: vi.fn(async (ref: string) =>
    ref === '1'
      ? { ref: '1', name: 'Acme', domain: 'acme.com', industry: null, headcount: 50, companyType: null, country: null, linkedinUrl: null, source: 'socialfetch' as const }
      : null,
  ),
}

function finder(verdicts: Record<string, 'safe' | 'invalid' | 'unknown'>, greylist: string[] = []): FinderDeps {
  const domains = new Map<string, any>()
  return {
    getDomain: (d) => domains.get(d) ?? null,
    updateDomain: (d, patch) => {
      const rec = { ...(domains.get(d) ?? { domain: d, pattern: null, pattern_confidence: 0 }), ...patch }
      domains.set(d, rec)
      return rec
    },
    resolveMx: async () => ['mx.acme.com'],
    verifier: {
      acquire: async () => ({ proxy: null, report: () => {} }),
      check: async (email) => ({
        reachability: verdicts[email] ?? 'invalid',
        isCatchAll: null,
        outcome: greylist.includes(email) ? 'greylisted' : 'ok',
      }),
    },
    now: () => Date.now(),
  }
}

beforeEach(() => {
  state.contacts = []
  state.list_contacts = []
  state.companies = []
  state.suppression = []
  state.disclosure = []
  state.unverifiable = []
  lookups.length = 0
  vi.mocked(source.getCompany).mockClear()
  vi.mocked(source.getPerson).mockClear()
})

describe('saveProspects', () => {
  it("doesn't look for new addresses once the plan's reveals are used up", async () => {
    allowance = { periodStart: '2026-10-15T00:00:00Z', periodEnd: null, upgradeUrl: null, limits: { reveals: 5 }, used: { ...{ prospects: 0, reveals: 0, emailsSent: 0 }, reveals: 5 } }
    try {
      const job = await saveProspects(1, [person('Jane', 'Smith')], { source, finder: finder({ 'jane.smith@acme.com': 'safe' }), db: fakeDb as any })
      expect(job.outcomes[0]).toMatchObject({ status: 'limit' })
      expect(state.contacts).toEqual([])
      expect(source.getCompany).not.toHaveBeenCalled()
    } finally {
      allowance = null
    }
  })

  it('finds, verifies and saves a contact with notice pending and a hashed disclosure entry', async () => {
    const job = await saveProspects(1, [person('Jane', 'Smith')], {
      source, finder: finder({ 'jane.smith@acme.com': 'safe' }), db: fakeDb as any,
    })

    expect(job.status).toBe('done')
    expect(job.outcomes[0]).toMatchObject({ status: 'saved', email: 'jane.smith@acme.com', emailStatus: 'verified' })
    expect(state.contacts[0]).toMatchObject({
      email: 'jane.smith@acme.com', first_name: 'Jane', source: 'socialfetch', email_status: 'verified', notice_status: 'pending',
    })
    expect(state.list_contacts).toEqual([{ list_id: 1, contact_email: 'jane.smith@acme.com' }])

    expect(state.disclosure).toHaveLength(1)
    const entry = state.disclosure[0]
    expect(entry).toMatchObject({ event: 'saved', sources: ['socialfetch'], notice_status: 'pending' })
    // Hashes only: no name, email or profile URL in the log.
    expect(JSON.stringify(entry)).not.toMatch(/jane|smith|acme|linkedin/i)
  })

  it('looks the company page up once for several people at the same company', async () => {
    await saveProspects(1, [person('Jane', 'Smith'), person('Bob', 'Jones'), person('Ann', 'Lee')], {
      source, finder: finder({}), db: fakeDb as any,
    })
    expect(source.getCompany).toHaveBeenCalledTimes(1)
    expect(state.companies[0]).toMatchObject({ domain: 'acme.com', page_checked: true })
  })

  it('skips suppressed people before spending anything on email finding', async () => {
    const jane = person('Jane', 'Smith', { companyDomain: 'acme.com' })
    fakeDb.addSuppression(hashesFor({ profileUrl: jane.profileUrl }))
    const f = finder({ 'jane.smith@acme.com': 'safe' })
    const check = vi.spyOn(f.verifier!, 'check')

    const job = await saveProspects(1, [jane], { source, finder: f, db: fakeDb as any })
    expect(job.outcomes[0].status).toBe('suppressed')
    expect(check).not.toHaveBeenCalled()
    expect(state.contacts).toEqual([])
  })

  it('blocks a save when the found address is suppressed', async () => {
    fakeDb.addSuppression(hashesFor({ email: 'jane.smith@acme.com' }))
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], {
      source, finder: finder({ 'jane.smith@acme.com': 'safe' }), db: fakeDb as any,
    })
    expect(job.outcomes[0].status).toBe('suppressed')
    expect(state.contacts).toEqual([])
  })

  it('looks up the employer from the profile when search did not say where someone works', async () => {
    const kim = person('Kim', 'Park', { company: '', companyRef: null, title: 'Data person' })
    const job = await saveProspects(1, [kim], { source, finder: finder({ 'kim.park@acme.com': 'safe' }), db: fakeDb as any })
    expect(source.getPerson).toHaveBeenCalledWith(kim.profileUrl)
    expect(job.outcomes[0]).toMatchObject({ status: 'saved', email: 'kim.park@acme.com', company: 'Acme' })
    expect(state.contacts[0]).toMatchObject({ job_title: 'Head of Data', company: 'Acme' })
  })

  it('reuses a revealed email instead of finding it again', async () => {
    const f = finder({})
    const check = vi.spyOn(f.verifier!, 'check')
    const revealed = person('Jane', 'Smith', { email: 'Jane.Smith@acme.com', emailStatus: 'verified' })
    const job = await saveProspects(1, [revealed], { source, finder: f, db: fakeDb as any })
    expect(check).not.toHaveBeenCalled()
    expect(source.getPerson).not.toHaveBeenCalled()
    expect(job.outcomes[0]).toMatchObject({ status: 'saved', email: 'jane.smith@acme.com', emailStatus: 'verified' })
  })

  it('still refuses a revealed email that has since been opted out', async () => {
    fakeDb.addSuppression(hashesFor({ firstName: 'Jane', lastName: 'Smith', domain: 'acme.com' }))
    const revealed = person('Jane', 'Smith', { email: 'jane.smith@acme.com', emailStatus: 'verified', profileUrl: 'https://www.linkedin.com/in/other' })
    const job = await saveProspects(1, [revealed], { source, finder: finder({}), db: fakeDb as any })
    expect(job.outcomes[0].status).toBe('suppressed')
  })

  // The mail server can't be checked for any of Jane's likely addresses.
  const allUnknown = Object.fromEntries(
    ['jane.smith', 'jsmith', 'jane', 'janesmith', 'jane_smith', 'j.smith'].map((l) => [`${l}@acme.com`, 'unknown' as const]),
  )

  it('does not save an unconfirmed address by default', async () => {
    const f = finder(allUnknown)
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], { source, finder: f, db: fakeDb as any })
    expect(job.outcomes[0]).toMatchObject({ status: 'unconfirmed', message: expect.stringMatching(/no address could be confirmed/) })
    expect(job.outcomes[0].email).toBeUndefined()
    expect(state.contacts).toEqual([])
    expect(state.disclosure).toEqual([])
  })

  it('remembers someone whose every likely address was rejected, but not someone the server never answered for', async () => {
    await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], { source, finder: finder({}), db: fakeDb as any })
    expect(state.unverifiable).toEqual([expect.objectContaining({ outcome: 'rejected' })])
    state.unverifiable = []
    await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], { source, finder: finder(allUnknown), db: fakeDb as any })
    expect(state.unverifiable).toEqual([])
  })

  it('refuses a revealed email that was not verified', async () => {
    const guess = person('Jane', 'Smith', { email: 'jane.smith@acme.com', emailStatus: 'catch_all_likely' })
    const job = await saveProspects(1, [guess], { source, finder: finder({}), db: fakeDb as any })
    expect(job.outcomes[0].status).toBe('unconfirmed')
    expect(state.contacts).toEqual([])
  })

  it('saves best guesses only when verified-only is switched off', async () => {
    const f = finder(allUnknown)
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], { source, finder: f, db: fakeDb as any, verifiedOnly: false })
    expect(job.outcomes[0]).toMatchObject({ status: 'saved', emailStatus: 'unverified' })
  })

  it('does not look up a profile again if search already checked it', async () => {
    const checked = person('Lee', 'Nobody', { company: '', companyRef: null, profileChecked: true })
    const job = await saveProspects(1, [checked], { source, finder: finder({}), db: fakeDb as any })
    expect(source.getPerson).not.toHaveBeenCalled()
    expect(job.outcomes[0].status).toBe('no_domain')
  })

  it("keeps the profile's title and employer when the employer has no company page", async () => {
    const jo = person('Jo', 'Bloggs', { company: '', companyRef: null, title: 'Building things | Speaker' })
    const job = await saveProspects(1, [jo], { source, finder: finder({}), db: fakeDb as any })
    expect(source.getPerson).toHaveBeenCalledWith(jo.profileUrl)
    expect(job.outcomes[0]).toMatchObject({ status: 'no_domain', company: 'Bloggs Ltd' })
  })

  it('keeps looking up profiles when one person just has no company page', async () => {
    const people = ['Aa', 'Bb', 'Cc'].map((n) => person(n, 'Nobody', { company: '', companyRef: null }))
    await saveProspects(1, people, { source, finder: finder({}), db: fakeDb as any })
    expect(source.getPerson).toHaveBeenCalledTimes(3)
  })

  it('stops looking up profiles in a save once a lookup itself fails', async () => {
    vi.mocked(source.getPerson).mockRejectedValueOnce(new Error('SocialFetch credits are exhausted.'))
    const people = ['Aa', 'Bb', 'Cc', 'Dd'].map((n) => person(n, 'Nobody', { company: '', companyRef: null }))
    const job = await saveProspects(1, people, { source, finder: finder({}), db: fakeDb as any })
    expect(source.getPerson).toHaveBeenCalledTimes(1)
    expect(job.outcomes.filter((o) => o.status === 'error')).toHaveLength(1)
    expect(job.outcomes.filter((o) => o.status === 'no_domain')).toHaveLength(3)
  })

  it('reports no_domain when the profile lists no employer either', async () => {
    const job = await saveProspects(1, [person('Lee', 'Nobody', { company: '', companyRef: null })], {
      source, finder: finder({}), db: fakeDb as any,
    })
    expect(job.outcomes[0]).toMatchObject({ status: 'no_domain', message: expect.stringMatching(/where they currently work/) })
  })

  it('does not spend a profile lookup on someone who opted out', async () => {
    const lee = person('Lee', 'Gone', { company: '', companyRef: null })
    fakeDb.addSuppression(hashesFor({ profileUrl: lee.profileUrl }))
    const job = await saveProspects(1, [lee], { source, finder: finder({}), db: fakeDb as any })
    expect(job.outcomes[0].status).toBe('suppressed')
    expect(source.getPerson).not.toHaveBeenCalled()
  })

  it('reports people whose company domain is unknown', async () => {
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyRef: '404' })], {
      source, finder: finder({}), db: fakeDb as any,
    })
    expect(job.outcomes[0].status).toBe('no_domain')
  })

  it('adds an existing contact to the list without touching its status or notice', async () => {
    state.contacts.push({ email: 'jane.smith@acme.com', first_name: 'J', last_name: 'S', job_title: '', company: '', status: 'unsubscribed', created_at: '' })
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], {
      source, finder: finder({ 'jane.smith@acme.com': 'safe' }), db: fakeDb as any,
    })
    expect(job.outcomes[0].status).toBe('already_saved')
    expect(state.contacts[0]).toMatchObject({ status: 'unsubscribed', first_name: 'J' })
    expect(state.contacts[0].notice_status).toBeUndefined()
    expect(state.disclosure).toEqual([])
  })

  it('retries greylisted people after a delay, then saves the best result', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const f = finder({})
    f.verifier!.check = async (email) => {
      calls++
      // Greylisted on the first pass, accepted on the retry.
      if (email === 'jane.smith@acme.com') {
        return calls <= 7
          ? { reachability: 'unknown', isCatchAll: null, outcome: 'greylisted' }
          : { reachability: 'safe', isCatchAll: null, outcome: 'ok' }
      }
      return { reachability: 'invalid', isCatchAll: null, outcome: 'ok' }
    }
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], { source, finder: f, db: fakeDb as any, sleep })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(job.outcomes[0]).toMatchObject({ status: 'saved', emailStatus: 'verified' })
    expect(job.processed).toBe(1)
    // Counted once, when final: the greylisted first pass isn't a lookup outcome.
    expect(lookups).toEqual(['verified'])
  })

  it('tries again at the end, instead of failing, when verification pacing held a lookup back', async () => {
    const sleep = vi.fn(async () => {})
    const f = finder({ 'jane.smith@acme.com': 'safe' })
    let acquired = 0
    f.verifier!.acquire = async () => {
      // Paced out on the first pass, a slot on the retry.
      if (acquired++ === 0) throw new VerificationLimitError('Verification is at its per-minute limit. Try again in a minute.', 'busy')
      return { proxy: null, report: () => {} }
    }
    const job = await saveProspects(1, [person('Jane', 'Smith', { companyDomain: 'acme.com' })], { source, finder: f, db: fakeDb as any, sleep })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(job.outcomes[0]).toMatchObject({ status: 'saved', emailStatus: 'verified' })
    // Waiting for a slot isn't a lookup outcome.
    expect(lookups).toEqual(['verified'])
  })

  it('returns a running job for large saves and finishes in the background', async () => {
    const people = Array.from({ length: 12 }, (_, i) => person(`P${String.fromCharCode(97 + i)}x`, 'Smith', { companyDomain: 'acme.com' }))
    const job = await saveProspects(1, people, { source, finder: finder({}), db: fakeDb as any })
    expect(job.status).toBe('running')
    expect(job.total).toBe(12)
    const { getJob } = await import('./save')
    await vi.waitFor(() => expect(getJob(job.id)?.status).toBe('done'))
  })
})

describe('processOptOut', () => {
  it('suppresses the person and removes them via the disclosure log when opting out by profile URL', async () => {
    const jane = person('Jane', 'Smith', { companyDomain: 'acme.com' })
    await saveProspects(1, [jane], { source, finder: finder({ 'jane.smith@acme.com': 'safe' }), db: fakeDb as any })
    expect(state.contacts).toHaveLength(1)

    const { removed } = await processOptOut({ profileUrl: 'https://uk.linkedin.com/in/Jane-Smith/' })
    expect(removed).toBe(1)
    expect(state.contacts).toEqual([])
    expect(state.list_contacts).toEqual([])
    expect(state.disclosure.at(-1)).toMatchObject({ event: 'opted_out' })

    // Also covered by the email and name hashes now, so every check blocks them.
    const suppressed = fakeDb.getSuppressionHashes()
    expect(suppressed.has(hashesFor({ email: 'jane.smith@acme.com' })[0].hash)).toBe(true)
    expect(hashesFor({ firstName: 'Jane', lastName: 'Smith', domain: 'acme.com' }).every((h) => suppressed.has(h.hash))).toBe(true)

    const again = await saveProspects(1, [jane], { source, finder: finder({ 'jane.smith@acme.com': 'safe' }), db: fakeDb as any })
    expect(again.outcomes[0].status).toBe('suppressed')
  })

  it('removes by email and by name + domain', async () => {
    state.contacts.push(
      { email: 'a@x.com', first_name: 'Al', last_name: 'Ng', job_title: '', company: '', status: 'subscribed', created_at: '' },
      { email: 'kim.park@acme.com', first_name: 'Kim', last_name: 'Park', job_title: '', company: '', status: 'subscribed', created_at: '' },
      { email: 'keep@acme.com', first_name: 'Keep', last_name: 'Me', job_title: '', company: '', status: 'subscribed', created_at: '' },
    )
    await processOptOut({ email: 'A@X.com' })
    await processOptOut({ firstName: 'Kím', lastName: 'Park', domain: 'https://www.acme.com' })
    expect(state.contacts.map((c) => c.email)).toEqual(['keep@acme.com'])
  })

  it('never suppresses on a first name alone', () => {
    expect(hashesFor({ firstName: 'Jane', lastName: '', domain: 'acme.com' })).toEqual([])
  })

  it('stores hashes, never the identifiers', async () => {
    await processOptOut({ email: 'jane@acme.com', profileUrl: 'https://www.linkedin.com/in/jane', firstName: 'Jane', lastName: 'Doe', domain: 'acme.com' })
    expect(state.suppression).toHaveLength(3)
    expect(JSON.stringify(state.suppression)).not.toMatch(/jane|acme|linkedin|doe/i)
    for (const s of state.suppression) expect(s.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
