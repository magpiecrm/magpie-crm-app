import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { HEADCOUNT_BUCKETS, SENIORITY_LEVELS } from '../prospecting/types'

const EMAIL_STATUSES = ['verified', 'catch_all_likely', 'risky', 'unverified', 'not_found'] as const

// Prospect search over SocialFetch. Search results are fetched live and never
// stored; only saving (saveProspectsFn) creates contacts, and that is the only
// place email finding runs. The logic lives in `src/server/prospecting/` so
// the copilot's tools get exactly the same behaviour.

const companySearchInput = z.object({
  keyword: z.string().trim().min(1, 'Enter a keyword to search companies').max(200),
  industry: z.string().trim().max(200).optional(),
  headcount: z.array(z.enum(HEADCOUNT_BUCKETS)).max(HEADCOUNT_BUCKETS.length).optional(),
  country: z.string().trim().max(100).optional(),
  cursor: z.string().max(20_000).optional(),
})

export const searchCompaniesFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof companySearchInput>) => companySearchInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { searchCompanies } = await import('../prospecting/search')
    return searchCompanies(data)
  })

const companyRefInput = z.object({ ref: z.string().trim().min(1).max(200) })

/** Fetches the company page when its domain isn't known yet (1 credit with its page name, else 6-9; then cached). */
export const resolveCompanyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof companyRefInput>) => companyRefInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { resolveCompany } = await import('../prospecting/search')
    return resolveCompany(data.ref)
  })

const setDomainInput = z.object({
  ref: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) => d.replace(/^https?:\/\//, '').replace(/^www\d?\./, '').replace(/\/.*$/, ''))
    .refine((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d), 'Enter a domain like acme.com'),
})

export const setCompanyDomainFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof setDomainInput>) => setDomainInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.upsertProspectCompanies([{ ref: data.ref, name: data.name, domain: data.domain, domain_source: 'user' }])
    return { ref: data.ref, domain: data.domain }
  })

const peopleSearchInput = z.object({
  company: z.object({ ref: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(300) }).nullable().optional(),
  titles: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  seniorities: z.array(z.enum(SENIORITY_LEVELS)).optional(),
  country: z.string().trim().max(100).optional(),
  keyword: z.string().trim().max(200).optional(),
  count: z.number().int().min(1).max(50).optional(),
  cursor: z.string().max(20_000).optional(),
})

/** Returns names, titles and companies only — never emails. */
export const searchPeopleFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof peopleSearchInput>) => peopleSearchInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { searchPeople } = await import('../prospecting/search')
    return searchPeople(data)
  })

const personInput = z.object({
  profileUrl: z.string().trim().url().max(500),
  firstName: z.string().trim().max(200),
  lastName: z.string().trim().max(200),
  title: z.string().trim().max(500),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  company: z.string().trim().max(300),
  companyRef: z.string().trim().max(200).nullable(),
  companySlug: z.string().trim().max(200).nullable().optional(),
  companyDomain: z.string().trim().max(253).nullable(),
  country: z.string().trim().max(100).nullable(),
  source: z.literal('socialfetch'),
  profileChecked: z.boolean().optional(),
  previously: z.enum(['saved', 'revealed']).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  emailStatus: z.enum(EMAIL_STATUSES).optional(),
})

/**
 * Finds and verifies one person's work email without saving them. Uses
 * Reacher (free) and, only if the company's website isn't cached yet, one
 * company-page lookup (1 credit, or 6-9 without the page name).
 */
export const revealEmailFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { person: z.input<typeof personInput> }) => z.object({ person: personInput }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { revealEmail } = await import('../prospecting/reveal')
    const { getSource, getFinderDeps } = await import('../prospecting/runtime')
    const { isVerifiedOnly } = await import('../prospecting/settings')
    const { db } = await import('../db')
    return revealEmail(data.person, { source: getSource(), finder: await getFinderDeps(), db, verifiedOnly: isVerifiedOnly() })
  })

const saveInput = z.object({
  listId: z.number().int().positive(),
  people: z.array(personInput).min(1).max(500),
})

export const saveProspectsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof saveInput>) => saveInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { startSave } = await import('../prospecting/search')
    return startSave(data.listId, data.people)
  })

export const prospectJobFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { jobId: string }) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { getJob } = await import('../prospecting/save')
    const job = getJob(data.jobId)
    if (!job) throw new Error('That save job has expired or never existed.')
    return job
  })

/** SocialFetch balance plus verification setup and proxy health, for the sidebar. */
export const prospectingStatusFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { getSocialFetchBalance } = await import('../prospecting/socialfetch')
    const { getNeverBounceCredits } = await import('../prospecting/neverbounce')
    const { getActiveVerifier, getNeverBounceKey, isSocialFetchConfigured, isVerifiedOnly, requireSocialFetchKey } = await import(
      '../prospecting/settings'
    )
    const { getProxyRouter } = await import('../prospecting/runtime')

    const configured = isSocialFetchConfigured()
    const nbKey = getNeverBounceKey()
    // Both balance calls are free. A failure shows as "Unavailable"; the
    // settings page's tests give the reason.
    const [balance, nbCredits] = await Promise.all([
      configured ? getSocialFetchBalance(requireSocialFetchKey()).catch(() => null) : Promise.resolve(null),
      nbKey ? getNeverBounceCredits(nbKey).catch(() => null) : Promise.resolve(null),
    ])
    const verifier = getActiveVerifier()
    const { db } = await import('../db')
    const health = db.getSenderHealth()
    return {
      socialfetch: { configured, balance },
      neverbounce: { configured: Boolean(nbKey), credits: nbCredits, inUse: verifier?.provider === 'neverbounce' },
      verification: { provider: verifier?.provider ?? null, verifiedOnly: isVerifiedOnly() },
      reacher: {
        configured: verifier?.provider === 'reacher',
        proxies: verifier?.provider === 'reacher' ? getProxyRouter().health() : [],
      },
      // Only while Reacher is verifying: an old report shouldn't warn after switching away.
      senderHealth:
        health && (verifier?.provider === 'reacher' || (verifier?.provider === 'neverbounce' && verifier.fallback))
          ? {
              level: health.level,
              checkedAt: health.checked_at,
              // What the worst problem is about, for the sidebar's wording.
              problem: health.ips.some((i) => i.level === 'critical')
                ? ('ip' as const)
                : health.domain?.level === 'critical'
                  ? ('domain' as const)
                  : ('setup' as const),
            }
          : null,
    }
  })

// --- Settings → Prospecting ---------------------------------------------------
// Unlike getEnvVarsFn, secrets are never sent back to the browser: only whether
// they're set and the last four characters of the SocialFetch key.

export const getProspectingSettingsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { getMaskedProspectingSettings } = await import('../prospecting/settings')
    return getMaskedProspectingSettings()
  })

const settingsInput = z.object({
  socialfetchApiKey: z.string().trim().max(500).optional(),
  reacherUrl: z.string().trim().max(500).optional(),
  reacherSecret: z.string().trim().max(500).optional(),
  reacherFromEmail: z.string().trim().max(254).optional(),
  reacherHelloName: z.string().trim().max(253).optional(),
  proxies: z
    .array(
      z.object({
        label: z.string().trim().max(60).optional(),
        host: z.string().trim().min(1).max(253),
        port: z.number().int().min(1).max(65535),
        username: z.string().trim().max(200).optional(),
        password: z.string().max(500).optional(),
      }),
    )
    .max(50)
    .optional(),
  verificationProvider: z.enum(['reacher', 'neverbounce', 'none']).optional(),
  neverbounceApiKey: z.string().trim().max(200).optional(),
  reacherFallback: z.boolean().optional(),
  verifiedOnly: z.boolean().optional(),
  clear: z.array(z.enum(['socialfetchApiKey', 'reacherSecret', 'neverbounceApiKey'])).optional(),
})

export const saveProspectingSettingsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof settingsInput>) => settingsInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { saveProspectingSettings, getMaskedProspectingSettings } = await import('../prospecting/settings')
    saveProspectingSettings(data)
    // New proxies or a new FROM/HELO shouldn't wait six hours to be checked.
    const { runSenderHealthCheck } = await import('../prospecting/senderHealthMonitor')
    runSenderHealthCheck().catch((err) => console.error('[SenderHealth] Check failed:', err?.message ?? err))
    return getMaskedProspectingSettings()
  })

/** Runs a no-real-mailbox SMTP check through Reacher, directly or via each proxy. */
export const testVerificationFn = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { testVerification } = await import('../prospecting/verificationTest')
    return testVerification()
  })

/** Latest blocklist / reverse DNS / SPF report for the IPs and domain Reacher verifies from. */
export const senderHealthFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    return db.getSenderHealth()
  })

/** Runs the sender health check now. Null when Reacher isn't in use. */
export const checkSenderHealthFn = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { runSenderHealthCheck } = await import('../prospecting/senderHealthMonitor')
    return runSenderHealthCheck()
  })

/**
 * Checks a SocialFetch key against the free balance endpoint. Tests the key
 * typed into the form when given, otherwise the saved one.
 */
export const testSocialFetchKeyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { apiKey?: string }) => z.object({ apiKey: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { getSocialFetchBalance } = await import('../prospecting/socialfetch')
    const { requireSocialFetchKey } = await import('../prospecting/settings')
    try {
      const balance = await getSocialFetchBalance(data.apiKey || requireSocialFetchKey())
      return { ok: true as const, balance }
    } catch (err: any) {
      return { ok: false as const, error: String(err?.message ?? 'Could not reach SocialFetch') }
    }
  })
