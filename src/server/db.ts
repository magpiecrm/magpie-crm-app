import { readFileSync, writeFileSync, existsSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { env } from './env'
import { normalizePersonaCriteria } from '../features/prospects/types'
import type { Persona, PersonaCriteria } from '../features/prospects/types'
import type { Activity, Company, Deal, Pipeline } from '../features/sales/types'
import type { Survey, SurveyResponse } from '../features/survey-builder/types'
import type { EmailTemplate } from '../features/templates/types'
import type { ContactCustomValue, ContactFieldDef } from '../features/contacts/contactFields'
import { isUnconfirmedGuess, type EmailStatus, type NoticeStatus } from './prospecting/types'
import type { MailFamily, MailProvider } from './prospecting/proxyRouter'
import type { SenderHealthReport } from './prospecting/senderHealth'
import type { KnownAddress } from './prospecting/patternEvidence'
import type { UsageCounter } from './usage'
import type { Allowance } from './allowance'
import type { SendingDomain } from './sendingDomains'
import type { SuppressionKind } from './prospecting/suppressionHash'
import { automatedClicks, automatedOpens, type ClickEvent, type OpenEvent } from './clickFilter'

export type EmailStopReason = 'unsubscribed' | 'complained' | 'bounced'

/** The contact status that goes with each stop. */
const STOP_STATUS: Record<EmailStopReason, string> = { unsubscribed: 'unsubscribed', complained: 'unsubscribed', bounced: 'bounced' }

/** Days of daily usage counts kept (about 13 months), for periods like the last 7 or 30 days. */
export const DAILY_USAGE_DAYS = 400

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false
  const [salt, hash] = storedHash.split(':')
  const verify = crypto.scryptSync(password, salt, 64).toString('hex')
  
  const buf1 = Buffer.from(verify, 'hex')
  const buf2 = Buffer.from(hash, 'hex')
  if (buf1.length !== buf2.length) {
    return false
  }
  return crypto.timingSafeEqual(buf1, buf2)
}



// We will use a JSON-based database to ensure 100% compatibility across both Node.js and Bun runtimes.
// This prevents errors like "ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'bun:'" when Node.js runs the Vite server.
const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'local_db.json')

type ApiKeyScope = 'api' | 'mcp'

export type NotificationType = 'contact_added' | 'form_submission' | 'campaign_sent' | 'campaign_failed' | 'survey_response' | 'verifier_alert' | 'task_due'

type ContactRecord = DbSchema['contacts'][number]
export type RecipientRecord = DbSchema['campaign_recipients'][number]

/** Enough for any real email, and keeps one recipient's row from growing without end. */
const MAX_LINKS_PER_RECIPIENT = 50
/** Clicks kept per recipient to judge which were automated; older ones are folded into the totals. */
const MAX_CLICK_EVENTS = 100

/** How long a search's stopping point is kept, and how many are kept at most. */
const SEARCH_POSITION_MS = 30 * 24 * 60 * 60_000
const MAX_SEARCH_POSITIONS = 300

export interface DbSchema {
  lists: Array<{ id: number; name: string; created_at: string }>
  contacts: Array<{
    email: string
    first_name: string
    last_name: string
    job_title: string
    company: string
    status: string
    created_at: string
    /** Values of user-defined contact fields, keyed by `ContactFieldDef.key`. */
    custom?: Record<string, ContactCustomValue>
    /** Where a prospected contact came from (e.g. `socialfetch`). Absent for imports and signups. */
    source?: string
    /** Result of email finding for prospected contacts. */
    email_status?: EmailStatus
    /** Whether this person has been told we hold their details. Prospected contacts start `pending`. */
    notice_status?: NoticeStatus
    /**
     * When they last signed themselves up (a form, /api/subscribe, a survey).
     * Consent given after an opt-out from prospecting lets campaigns reach them.
     */
    signed_up_at?: string
    /** The company they work at (sales/companies.ts links them by email domain or name). */
    company_id?: string | null
  }>
  list_contacts: Array<{ list_id: number; contact_email: string }>
  senders: Array<{ id: number; name: string; email: string }>
  campaigns: Array<{
    id: number
    name: string
    subject: string
    preview_text: string | null
    html_content: string
    list_id: number | null
    sender_id: number | null
    status: string
    unsubscribe_enabled: boolean
    /**
     * Adds the hidden open-tracking image. The sender needs recipients'
     * consent for it (PECR). Missing on campaigns from before the setting,
     * which tracked opens.
     */
    track_opens?: boolean
    created_at: string
    sent_at: string | null
    /** When a 'scheduled' campaign sends (ISO); the email scheduler sends it once due. */
    scheduled_at?: string | null
    /** Unconfirmed prospected addresses held back after a first batch (guessedRecipients.ts). */
    guess_hold?: GuessHold | null
  }>
  campaign_recipients: Array<{
    campaign_id: number
    contact_email: string
    status: string
    /** First open and first click (a click counts as an open: images may be off). */
    opened_at: string | null
    clicked_at: string | null
    /** When it went out. Missing on rows from before this was recorded. */
    sent_at?: string | null
    /** Every time the email's images loaded for a person (clickFilter.ts); `opened_at` and `last_opened_at` are theirs. */
    opens?: number
    last_opened_at?: string | null
    /** Loads judged automated (security scanners; clickFilter.ts), not in `opens`. */
    bot_opens?: number
    /** Recent image loads, to judge which were automated; at most MAX_CLICK_EVENTS. */
    open_events?: OpenEvent[]
    /** Opens from before open_events were kept (or folded out of them), counted as people's. */
    opens_before?: { opens: number; first: string | null; last: string | null; bots: number }
    /** People's clicks (clickFilter.ts); `clicked_at` is the first of them. */
    clicks?: number
    /** People's clicks per link (URL → count), capped at MAX_LINKS_PER_RECIPIENT links. */
    links?: Record<string, number>
    /** Clicks judged automated (security scanners; clickFilter.ts), not in `clicks`. */
    bot_clicks?: number
    /** Recent tracked clicks, to judge which were automated; at most MAX_CLICK_EVENTS. */
    click_events?: ClickEvent[]
    /** Clicks from before click_events were kept (or folded out of them), counted as people's. */
    clicks_before?: { clicks: number; links: Record<string, number>; at: string | null; bots: number }
    /** When the email's hidden trap link was followed: something automated read it. */
    trapped_at?: string | null
    bounced_at?: string | null
    unsubscribed_at?: string | null
    /** Marked the email as spam. They are unsubscribed too. */
    complained_at?: string | null
  }>
  users: Array<{
    email: string
    passwordHash: string
    /**
     * Hash of the AUTH_PASSWORD last applied to this user, so a restart only
     * resets the password when the env var itself changed, not after the user
     * changed it in the app.
     */
    envPasswordHash?: string
  }>
  sessions: Array<{
    id: string
    email: string
    expiresAt: string
  }>
  api_keys?: Array<{
    id: string
    name: string
    key_hash: string
    masked_key: string
    created_at: string
    /**
     * `api` (the default, and every key made before scopes existed): the
     * public API such as signup forms, which may sit in a website's code.
     * `mcp`: full access for an AI app over MCP. Neither works as the other.
     */
    scope?: ApiKeyScope
    last_used_at?: string
  }>
  forms?: Array<{
    id: string
    name: string
    fields: string[]
    list_id: number
    save_to_list_enabled?: boolean
    save_to_list_fields?: string[]
    welcome_email_enabled: boolean
    welcome_email_subject: string
    welcome_email_body: string
    welcome_email_delay_minutes: number
    sender_id: number | null
    created_at: string
  }>
  form_submissions?: Array<{
    form_id: string
    contact_email: string
    submitted_at: string
    message?: string
  }>
  pending_emails?: Array<{
    id: string
    contact_email: string
    first_name: string
    subject: string
    html: string
    from?: string
    send_after: string
    sent: boolean
    /** Failed sends so far; given up after a few. */
    attempts?: number
    /** Why it's no longer due: sent, skipped (they'd unsubscribed or bounced by then), or failed. */
    outcome?: 'sent' | 'skipped' | 'failed'
  }>
  personas?: Persona[]
  notifications?: Array<{
    id: string
    type: NotificationType
    message: string
    contact_email?: string
    created_at: string
    read: boolean
  }>
  // Web Push endpoints, one per installed home-screen app. Pruned when the
  // push service reports them gone (see server/push.ts).
  push_subscriptions?: Array<{
    endpoint: string
    keys: { p256dh: string; auth: string }
    created_at: string
  }>
  /**
   * Brand kit — colours, fonts, logo and tone. Injected into the copilot's
   * system prompt and used as defaults when it builds a design, so output is
   * on-brand without being asked every time. Single row.
   */
  brand_kit?: {
    name?: string
    logoUrl?: string
    primaryColor?: string
    accentColor?: string
    backgroundColor?: string
    textColor?: string
    fontFamily?: string
    toneOfVoice?: string
    websiteUrl?: string
    footerAddress?: string
    updated_at: string
  }
  /**
   * Which provider sends outbound mail, and the credentials for each. Single
   * row, like brand_kit. Credentials are kept per provider (not just for the
   * active one) so switching away and back does not lose the keys, and secret
   * fields are stored as AES-256-GCM blobs — see emailSettings.ts.
   */
  email_settings?: {
    provider: string
    defaultSender?: string
    /** provider id -> encrypted blob of that provider's credential record. */
    credentials: Record<string, string>
    /** Detects rotation of the encryption secret, which would orphan the blobs. */
    secret_fingerprint?: string
    updated_at: string
  }
  /**
   * Copilot conversations. After a restart the agent rebuilds the
   * conversation from these messages, so a stored chat can be continued.
   */
  copilot_chats?: Array<{
    id: string
    title: string
    created_at: string
    updated_at: string
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      isError?: boolean
      tools?: Array<{ name: string; status: string }>
    }>
  }>
  surveys?: Survey[]
  survey_responses?: SurveyResponse[]
  email_templates?: EmailTemplate[]
  /** Definitions of user-defined contact fields; values live on `contacts[].custom`. */
  contact_fields?: ContactFieldDef[]
  // --- Prospecting ---
  // Only non-personal data is cached globally: companies, their domains and
  // each domain's mail pattern and catch-all status. People found by search
  // are never stored unless the user saves them as contacts.
  prospect_companies?: Array<{
    ref: string
    name: string
    domain: string | null
    domain_source: 'socialfetch' | 'user'
    /** The full company page has been fetched; a null domain is then final. */
    page_checked?: boolean
    /** Staff count, when known: sets how likely a first.last best guess is. */
    headcount?: number | null
    /** LinkedIn company page name, for the 1-credit company lookup. */
    slug?: string | null
    updated_at: string
  }>
  email_domains?: EmailDomainRecord[]
  /**
   * Global suppression list. Keyed HMAC hashes only (see
   * prospecting/suppression.ts), never the raw email, name or URL.
   */
  suppression?: Array<{
    hash: string
    kind: SuppressionKind
    /** 'shared': passed on by the host from another copy (/api/usage/suppressions). */
    reason: 'opt_out' | 'erasure' | 'manual' | 'shared'
    created_at: string
  }>
  /**
   * One entry per prospected contact saved, and per notice status change.
   * Hashes only, so it can answer "do we hold this person, and since when"
   * for rights requests without itself being a copy of the contact list.
   */
  disclosure_log?: DisclosureEntry[]
  /**
   * People whose email lookup ended in a way no retry changes, kept 90 days
   * so search can leave them out (prospecting/unverifiable.ts). Keyed HMAC
   * hash of the profile URL only.
   */
  unverifiable?: Array<{ hash: string; outcome: string; created_at: string }>
  /**
   * Where each people search last stopped, so the same filters carry on from
   * there next time instead of showing the same first pages again. Keyed by
   * a hash of the filters; the value is the search's page cursor (offsets),
   * never anyone found.
   */
  search_positions?: Record<string, { cursor: string; updated_at: string }>
  /**
   * Sales (server/sales/). `companies` is absent until contacts have first
   * been grouped into companies; pipelines get a default on first use.
   */
  companies?: Company[]
  pipelines?: Pipeline[]
  deals?: Deal[]
  activities?: Activity[]
  /**
   * Prospecting integrations set from Settings → Data source and Email verification. Single row.
   * `secrets` is an AES-256-GCM blob (see prospecting/settings.ts) holding the
   * SocialFetch API key and the verification server's secret; the rest isn't sensitive.
   */
  prospecting_settings?: ProspectingSettingsRecord
  /**
   * Copilot settings from Settings → Copilot. `secrets` is an AES-256-GCM blob
   * (see copilot/settings.ts) holding the Anthropic API key.
   */
  copilot_settings?: { secrets?: string; updated_at: string }
  /**
   * Latest blocklist / reverse DNS / SPF check of the IPs and FROM domain
   * the verification server checks from (prospecting/senderHealth.ts). The app's own
   * infrastructure only; no personal data.
   */
  sender_health?: SenderHealthReport
  /**
   * Monthly usage counts, keyed by "YYYY-MM" (see usage.ts). Counts only: no
   * names, addresses or searches.
   */
  usage?: Record<string, Partial<Record<UsageCounter, number>>>
  /** The same counts by UTC day (YYYY-MM-DD), for any period; the last DAILY_USAGE_DAYS kept. */
  usage_daily?: Record<string, Partial<Record<UsageCounter, number>>>
  /**
   * Addresses not to email again, by a keyed hash (never the address): an
   * unsubscribe, a spam complaint or a hard bounce. Kept when the contact is
   * deleted, so a re-import doesn't start emailing them again. This copy's
   * own; unlike the opt-out list, never shared. Lifted by re-subscribing them
   * or them signing up again.
   */
  email_stops?: Record<string, { reason: EmailStopReason; at: string }>
  /** Up to when Cloudflare's bounces have been read (bouncePoller.ts). */
  bounce_poller_since?: string
  /** This billing period's allowances, when a host sets them (see allowance.ts). */
  allowance?: Allowance | null
  /** Domains mail is sent from when the host runs sending (see sendingDomains.ts). */
  sending_domains?: SendingDomain[]
}

export interface ProspectingSettingsRecord {
  secrets?: string
  /**
   * Whether emails are verified (by the verification server) or not. Absent means "verify when
   * it's set up". `neverbounce` may linger from before it was removed; it's
   * treated as absent.
   */
  verification_provider?: 'reacher' | 'none' | 'neverbounce'
  /** Only hand over emails the mail server confirmed. Absent means true. */
  verified_only?: boolean
  /**
   * With verified-only on, leave people whose email can't be verified out of
   * search results: at companies known to accept every address or take no
   * email, or remembered from a failed lookup (prospecting/unverifiable.ts).
   * Absent means true. False shows them, marked Unverifiable.
   */
  hide_unverifiable?: boolean
  /**
   * With verified-only on, still hand over addresses at companies that
   * accept every address when their format is well established
   * (`format_confirmed`). Absent means on in a hosted copy, off otherwise.
   */
  allow_format_confirmed?: boolean
  reacher_url?: string
  reacher_from_email?: string
  reacher_hello_name?: string
  /** Checks per verifying IP per day. Absent means the default (1,500). */
  verification_daily_cap?: number
  /**
   * Keep verifying even though this FROM domain is blocklisted (for testing
   * until a replacement is ready). Only applies to this exact domain.
   */
  listed_domain_override?: string | null
  updated_at: string
}

export type { SuppressionKind }

/**
 * A campaign's unconfirmed addresses held back after a first batch
 * (guessedRecipients.ts): `waiting` until `release_at`, then `released`
 * (sent) or `stopped` (too many of the first batch bounced).
 */
export interface GuessHold {
  status: 'waiting' | 'released' | 'stopped'
  /** Unconfirmed addresses in the first batch. */
  first_batch: number
  /** How many were held back. */
  held: number
  release_at: string
  /** Hard-bounce share of the first batch above which the rest stay held (the rules when it started). */
  max_bounce_rate?: number
  /** Hard bounces among the first batch, once looked at. */
  hard_bounces?: number
}

export interface EmailDomainRecord {
  domain: string
  /** e.g. `{first}.{last}`. Never stored with a name or address. */
  pattern: string | null
  pattern_confidence: number
  pattern_verified_at: string | null
  catch_all: boolean | null
  catch_all_checked_at: string | null
  /**
   * What set `catch_all` to true: the verification server's own made-up
   * address in the same session (`reacher_flag`), our made-up address being
   * accepted (`probe_accepted`), or a guess's check (`candidate_flag`).
   * Missing on records flagged before this was kept.
   */
  catch_all_source?: 'reacher_flag' | 'probe_accepted' | 'candidate_flag' | null
  /** A second made-up address, in a separate session, was accepted too. */
  catch_all_confirmed?: boolean
  /** The catch-all test was inconclusive; don't repeat it before this. */
  catch_all_recheck_at?: string | null
  mx_provider: MailProvider | null
  /** Mailbox host or email security gateway behind the MX (finer than `mx_provider`). */
  mx_family?: MailFamily | null
  /** False when the domain has no MX records at all. */
  accepts_mail: boolean | null
  mx_checked_at: string | null
  last_used_at: string
}

interface DisclosureEntry {
  id: string
  contact_hash: string
  profile_hash: string | null
  sources: string[]
  event: 'saved' | 'revealed' | 'notice_status_changed' | 'opted_out'
  notice_status: NoticeStatus | null
  created_at: string
}

class JsonDb {
  public data: DbSchema

  constructor() {
    this.data = this.load()
    this.seedDefaultData()
  }

  transaction(fn: (...args: any[]) => any) {
    return (...args: any[]) => fn(...args)
  }

  private load(): DbSchema {
    let loaded: DbSchema
    if (existsSync(dbPath)) {
      try {
        loaded = JSON.parse(readFileSync(dbPath, 'utf8'))
      } catch (err) {
        console.error('Failed to parse database file. Starting fresh.', err)
        loaded = this.getFreshSchema()
      }
    } else {
      loaded = this.getFreshSchema()
    }
    
    // Ensure all schema fields are present
    if (!loaded.sessions) loaded.sessions = []
    if (!loaded.users) loaded.users = []
    if (!loaded.api_keys) loaded.api_keys = []
    if (!loaded.forms) loaded.forms = []
    if (!loaded.form_submissions) loaded.form_submissions = []
    if (!loaded.pending_emails) loaded.pending_emails = []
    if (!loaded.personas) loaded.personas = []
    if (!loaded.notifications) loaded.notifications = []
    if (!loaded.push_subscriptions) loaded.push_subscriptions = []
    if (!loaded.copilot_chats) loaded.copilot_chats = []
    if (!loaded.prospect_companies) loaded.prospect_companies = []
    if (!loaded.email_domains) loaded.email_domains = []
    if (!loaded.suppression) loaded.suppression = []
    if (!loaded.disclosure_log) loaded.disclosure_log = []
    if (!loaded.unverifiable) loaded.unverifiable = []
    if (!loaded.surveys) loaded.surveys = []
    if (!loaded.survey_responses) loaded.survey_responses = []
    if (!loaded.email_templates) loaded.email_templates = []
    if (!loaded.contact_fields) loaded.contact_fields = []

    return loaded
  }

  private getFreshSchema(): DbSchema {
    return {
      lists: [],
      contacts: [],
      list_contacts: [],
      senders: [],
      campaigns: [],
      campaign_recipients: [],
      users: [],
      sessions: [],
      api_keys: [],
      forms: [],
      form_submissions: [],
      pending_emails: [],
      personas: [],
      notifications: [],
      push_subscriptions: [],
      copilot_chats: [],
      prospect_companies: [],
      email_domains: [],
      suppression: [],
      disclosure_log: [],
      unverifiable: [],
      surveys: [],
      survey_responses: [],
      email_templates: [],
      contact_fields: [],
    }
  }

  // --- Prospecting: company and domain caches (non-personal) ---
  getProspectCompany(ref: string) {
    return this.data.prospect_companies!.find((c) => c.ref === ref) ?? null
  }

  /** Batch upsert — a search page caches up to 25 companies with one write. */
  upsertProspectCompanies(
    entries: Array<{
      ref: string
      name: string
      domain: string | null
      domain_source: 'socialfetch' | 'user'
      page_checked?: boolean
      headcount?: number | null
      slug?: string | null
    }>,
  ) {
    const list = this.data.prospect_companies!
    const now = new Date().toISOString()
    for (const entry of entries) {
      const existing = list.find((c) => c.ref === entry.ref)
      if (!existing) {
        list.push({ ...entry, updated_at: now })
        continue
      }
      // A domain the user typed in wins over whatever the provider says later,
      // and a search hit without a website doesn't erase one we already know.
      if (existing.domain_source === 'user' && entry.domain_source !== 'user') {
        existing.name = entry.name
        existing.headcount = entry.headcount ?? existing.headcount
        existing.slug = entry.slug ?? existing.slug
      } else {
        Object.assign(existing, {
          ...entry,
          domain: entry.domain ?? existing.domain,
          page_checked: entry.page_checked || existing.page_checked,
          headcount: entry.headcount ?? existing.headcount,
          slug: entry.slug ?? existing.slug,
        })
      }
      existing.updated_at = now
    }
    if (entries.length > 0) this.save()
  }

  getEmailDomain(domain: string): EmailDomainRecord | null {
    return this.data.email_domains!.find((d) => d.domain === domain) ?? null
  }

  upsertEmailDomain(domain: string, patch: Partial<Omit<EmailDomainRecord, 'domain'>>): EmailDomainRecord {
    const list = this.data.email_domains!
    let record = list.find((d) => d.domain === domain)
    if (!record) {
      record = {
        domain,
        pattern: null,
        pattern_confidence: 0,
        pattern_verified_at: null,
        catch_all: null,
        catch_all_checked_at: null,
        mx_provider: null,
        accepts_mail: null,
        mx_checked_at: null,
        last_used_at: new Date().toISOString(),
      }
      list.push(record)
    }
    Object.assign(record, patch, { last_used_at: new Date().toISOString() })
    this.save()
    return record
  }

  /**
   * Addresses already held at `domain`, as evidence of its format
   * (patternEvidence.ts): contacts not from prospecting, or prospected and
   * verified, are `known`; an unconfirmed prospected address counts once it
   * was clicked (`engaged`) or hard-bounced (`bounced`), and not otherwise.
   * Read at lookup time and never copied anywhere.
   */
  knownAddressesAt(domain: string): KnownAddress[] {
    const suffix = `@${domain.toLowerCase()}`
    return this.knownAddresses((email) => email.endsWith(suffix))
  }

  /** `knownAddressesAt` for every domain at once (sharedFormats.ts reports them, as counts). */
  allKnownAddresses(): KnownAddress[] {
    return this.knownAddresses(() => true)
  }

  private knownAddresses(match: (email: string) => boolean): KnownAddress[] {
    const contacts = this.data.contacts.filter((c) => match(c.email) && c.first_name && c.last_name)
    if (contacts.length === 0) return []
    const emails = new Set(contacts.map((c) => c.email))
    const bounced = new Set<string>()
    const clicked = new Set<string>()
    for (const r of this.data.campaign_recipients) {
      if (!emails.has(r.contact_email)) continue
      if (r.status === 'bounced_hard') bounced.add(r.contact_email)
      else if (r.clicked_at) clicked.add(r.contact_email)
    }
    return contacts.flatMap((c): KnownAddress[] => {
      const address = { email: c.email, firstName: c.first_name, lastName: c.last_name }
      if (!isUnconfirmedGuess(c)) return [{ ...address, kind: 'known' }]
      if (bounced.has(c.email)) return [{ ...address, kind: 'bounced' }]
      return clicked.has(c.email) ? [{ ...address, kind: 'engaged' }] : []
    })
  }

  // --- Prospecting: suppression and disclosure log (hashes only) ---
  getSuppressionHashes(): Set<string> {
    return new Set(this.data.suppression!.map((s) => s.hash))
  }

  /** This copy's own opt-outs (not ones the host passed on) recorded after `since`. */
  suppressionsSince(since: string | null) {
    return this.data.suppression!.filter((s) => s.reason !== 'shared' && (!since || s.created_at > since))
  }

  addSuppression(entries: Array<{ hash: string; kind: SuppressionKind }>, reason: 'opt_out' | 'erasure' | 'manual' | 'shared') {
    const existing = this.getSuppressionHashes()
    const now = new Date().toISOString()
    let added = 0
    for (const e of entries) {
      if (existing.has(e.hash)) continue
      existing.add(e.hash)
      this.data.suppression!.push({ hash: e.hash, kind: e.kind, reason, created_at: now })
      added++
    }
    if (added > 0) this.save()
    return added
  }

  getUnverifiable(): Array<{ hash: string; outcome: string; created_at: string }> {
    return this.data.unverifiable ?? []
  }

  setUnverifiable(entries: Array<{ hash: string; outcome: string; created_at: string }>) {
    this.data.unverifiable = entries
    this.save()
  }

  getSearchPosition(key: string): string | null {
    const entry = this.data.search_positions?.[key]
    if (!entry || Date.now() - new Date(entry.updated_at).getTime() > SEARCH_POSITION_MS) return null
    return entry.cursor
  }

  /** Remembers where a search stopped; null forgets it (the next one starts at the top). */
  setSearchPosition(key: string, cursor: string | null) {
    const positions = { ...(this.data.search_positions ?? {}) }
    if (cursor) positions[key] = { cursor, updated_at: new Date().toISOString() }
    else delete positions[key]
    // Keep the most recent few hundred searches.
    const keep = Object.entries(positions)
      .sort((a, b) => b[1].updated_at.localeCompare(a[1].updated_at))
      .slice(0, MAX_SEARCH_POSITIONS)
    this.data.search_positions = Object.fromEntries(keep)
    this.save()
  }

  addDisclosure(entry: Omit<DisclosureEntry, 'id' | 'created_at'>) {
    this.data.disclosure_log!.push({ ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString() })
    this.save()
  }

  getDisclosures(): DisclosureEntry[] {
    return [...this.data.disclosure_log!]
  }

  // --- Campaign sending state -------------------------------------------------
  // A campaign is 'draft' (or 'suspended'), 'scheduled' with a scheduled_at,
  // 'sending' while its emails go out, then 'sent'. Claiming it for sending
  // is one synchronous step, so a scheduled send and a manual send can never
  // both start the same campaign.

  campaignScheduledAt(id: number): string | null {
    return this.data.campaigns.find((c) => c.id === id)?.scheduled_at ?? null
  }

  /** Whether a campaign adds the open-tracking image (campaigns from before the setting do). */
  campaignTracksOpens(id: number): boolean {
    return this.data.campaigns.find((c) => c.id === id)?.track_opens !== false
  }

  setCampaignTrackOpens(id: number, on: boolean) {
    const campaign = this.data.campaigns.find((c) => c.id === id)
    if (!campaign || campaign.track_opens === on) return
    campaign.track_opens = on
    this.save()
  }

  /** Schedules a campaign for `at` (ISO), or with null takes it off the schedule. */
  setCampaignSchedule(id: number, at: string | null) {
    const campaign = this.data.campaigns.find((c) => c.id === id)
    if (!campaign) return
    campaign.scheduled_at = at
    if (at) campaign.status = 'scheduled'
    else if (campaign.status === 'scheduled') campaign.status = 'draft'
    this.save()
  }

  /** Scheduled campaigns whose time has come, oldest first. */
  dueScheduledCampaigns(now = new Date()): number[] {
    const iso = now.toISOString()
    return this.data.campaigns
      .filter((c) => c.status === 'scheduled' && c.scheduled_at && c.scheduled_at <= iso)
      .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1))
      .map((c) => c.id)
  }

  /** Campaigns left half-sent (the server stopped mid-send). */
  campaignsLeftSending(): number[] {
    return this.data.campaigns.filter((c) => c.status === 'sending').map((c) => c.id)
  }

  /**
   * Marks a campaign 'sending' unless it's already sending or sent. True if
   * this call claimed it (`resume` also claims one left 'sending'; `release`
   * a sent one, to send its held-back recipients).
   */
  claimCampaignForSending(id: number, opts: { resume?: boolean; release?: boolean } = {}): boolean {
    const campaign = this.data.campaigns.find((c) => c.id === id)
    if (!campaign || (campaign.status === 'sent' && !opts.release)) return false
    if (campaign.status === 'sending' && !opts.resume) return false
    campaign.status = 'sending'
    this.save()
    return true
  }

  setGuessHold(id: number, hold: GuessHold | null) {
    const campaign = this.data.campaigns.find((c) => c.id === id)
    if (!campaign) return
    campaign.guess_hold = hold
    this.save()
  }

  getGuessHold(id: number): GuessHold | null {
    return this.data.campaigns.find((c) => c.id === id)?.guess_hold ?? null
  }

  /** Sent campaigns whose held-back recipients are due a decision. */
  campaignsWithHeldGuessesDue(now = new Date()): number[] {
    const iso = now.toISOString()
    return this.data.campaigns
      .filter((c) => c.status === 'sent' && c.guess_hold?.status === 'waiting' && c.guess_hold.release_at <= iso)
      .map((c) => c.id)
  }

  /** Hard bounces this campaign got from prospected addresses that were never confirmed. */
  unconfirmedHardBounces(id: number): number {
    const bounced = new Set(
      this.data.campaign_recipients.filter((r) => r.campaign_id === id && r.status === 'bounced_hard').map((r) => r.contact_email),
    )
    return this.data.contacts.filter((c) => bounced.has(c.email) && isUnconfirmedGuess(c)).length
  }

  /** Back to 'sent' after sending held-back recipients stopped partway. */
  restoreSent(id: number) {
    const campaign = this.data.campaigns.find((c) => c.id === id)
    if (!campaign || campaign.status !== 'sending') return
    campaign.status = 'sent'
    this.save()
  }

  /** Puts a campaign that couldn't finish sending back to 'draft', off the schedule. */
  releaseCampaign(id: number) {
    const campaign = this.data.campaigns.find((c) => c.id === id)
    if (!campaign || campaign.status === 'sent') return
    campaign.status = 'draft'
    campaign.scheduled_at = null
    this.save()
  }

  /** Everyone a campaign has already gone to (or been tried on), so a resumed or repeated send skips them. */
  campaignRecipientEmails(id: number): Set<string> {
    return new Set(this.data.campaign_recipients.filter((r) => r.campaign_id === id).map((r) => r.contact_email))
  }

  getCopilotSettings(): { secrets?: string; updated_at: string } | null {
    return this.data.copilot_settings ?? null
  }

  saveCopilotSettings(next: { secrets?: string; updated_at: string }) {
    this.data.copilot_settings = next
    this.save()
  }

  getProspectingSettings(): ProspectingSettingsRecord | null {
    return this.data.prospecting_settings ?? null
  }

  saveProspectingSettings(next: ProspectingSettingsRecord) {
    this.data.prospecting_settings = next
    this.save()
  }

  getSenderHealth(): SenderHealthReport | null {
    return this.data.sender_health ?? null
  }

  saveSenderHealth(report: SenderHealthReport) {
    this.data.sender_health = report
    this.save()
  }

  /** Patches the prospecting fields on an existing contact without touching its status. */
  setContactProspectFields(email: string, patch: Partial<Pick<ContactRecord, 'source' | 'email_status' | 'notice_status'>>) {
    const contact = this.getContact(email)
    if (!contact) return null
    Object.assign(contact, patch)
    this.save()
    return contact
  }

  // API Key Management Helpers
  getApiKeys(scope: ApiKeyScope = 'api') {
    if (!this.data.api_keys) this.data.api_keys = []
    return this.data.api_keys
      .filter(k => (k.scope ?? 'api') === scope)
      .map(k => ({
        id: k.id,
        name: k.name,
        masked_key: k.masked_key,
        created_at: k.created_at,
        last_used_at: k.last_used_at ?? null,
      }))
  }

  addApiKey(name: string, keyHash: string, maskedKey: string, scope: ApiKeyScope = 'api') {
    if (!this.data.api_keys) this.data.api_keys = []
    const id = crypto.randomUUID()
    const record = {
      id,
      name,
      key_hash: keyHash,
      masked_key: maskedKey,
      created_at: new Date().toISOString(),
      scope,
    }
    this.data.api_keys.push(record)
    this.save()
    return id
  }

  deleteApiKey(id: string) {
    if (!this.data.api_keys) return
    this.data.api_keys = this.data.api_keys.filter(k => k.id !== id)
    this.save()
  }

  verifyApiKey(rawKey: string, scope: ApiKeyScope = 'api'): boolean {
    if (!this.data.api_keys) return false
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex')
    const key = this.data.api_keys.find(k => k.key_hash === hash && (k.scope ?? 'api') === scope)
    if (!key) return false
    // At most one write a minute per key, so a busy AI client doesn't rewrite
    // the whole database file on every call.
    const now = Date.now()
    if (!key.last_used_at || now - Date.parse(key.last_used_at) > 60_000) {
      key.last_used_at = new Date(now).toISOString()
      this.save()
    }
    return true
  }

  // Notification Helpers
  addNotification(type: NotificationType, message: string, contactEmail?: string) {
    if (!this.data.notifications) this.data.notifications = []
    this.data.notifications.push({
      id: crypto.randomUUID(),
      type,
      message,
      contact_email: contactEmail,
      created_at: new Date().toISOString(),
      read: false,
    })
    this.save()
  }

  getNotifications(limit = 20) {
    if (!this.data.notifications) this.data.notifications = []
    return [...this.data.notifications]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
  }

  getUnreadNotificationCount() {
    if (!this.data.notifications) return 0
    return this.data.notifications.filter(n => !n.read).length
  }

  markNotificationsRead(ids?: string[]) {
    if (!this.data.notifications) return
    for (const n of this.data.notifications) {
      if (!ids || ids.includes(n.id)) n.read = true
    }
    this.save()
  }

  /** Permanently removes notifications — all of them, or just the given ids. */
  clearNotifications(ids?: string[]) {
    if (!this.data.notifications) return
    this.data.notifications = ids
      ? this.data.notifications.filter(n => !ids.includes(n.id))
      : []
    this.save()
  }

  // Push Subscription Helpers

  addPushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    if (!this.data.push_subscriptions) this.data.push_subscriptions = []
    // The endpoint is the identity of a subscription; re-subscribing on the same
    // device returns the same one, so replace rather than accumulate duplicates.
    const existing = this.data.push_subscriptions.findIndex(s => s.endpoint === sub.endpoint)
    const record = { endpoint: sub.endpoint, keys: sub.keys, created_at: new Date().toISOString() }
    if (existing >= 0) {
      this.data.push_subscriptions[existing] = record
    } else {
      this.data.push_subscriptions.push(record)
    }
    this.save()
  }

  removePushSubscription(endpoint: string) {
    if (!this.data.push_subscriptions) return
    this.data.push_subscriptions = this.data.push_subscriptions.filter(s => s.endpoint !== endpoint)
    this.save()
  }

  getPushSubscriptions() {
    if (!this.data.push_subscriptions) this.data.push_subscriptions = []
    return [...this.data.push_subscriptions]
  }

  private saveData(data: DbSchema) {
    const tempPath = `${dbPath}.tmp`
    writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tempPath, dbPath)
  }

  private save() {
    this.saveData(this.data)
  }

  /**
   * Runs a change to the data made by a domain module (e.g. server/sales/),
   * then saves it. The change runs synchronously, so nothing interleaves.
   */
  /**
   * How big the data file is, and how many rows each collection holds, for
   * whoever runs this copy (GET /api/usage): the whole file is rewritten on
   * every save, so it slows down as it grows.
   */
  storageStats(): { bytes: number; rows: Record<string, number> } {
    let bytes = 0
    try {
      bytes = statSync(dbPath).size
    } catch {
      // not written yet
    }
    const rows: Record<string, number> = {}
    for (const [key, value] of Object.entries(this.data)) if (Array.isArray(value)) rows[key] = value.length
    return { bytes, rows }
  }

  mutate<T>(change: (data: DbSchema) => T): T {
    const result = change(this.data)
    this.save()
    return result
  }


  /** The id of the row the last INSERT into senders, lists or campaigns created (sqlite's last_insert_rowid()). */
  private lastInsertId = 0

  // Mimics sqlite's db.run
  run(sql: string, params: any[] = []) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim()

    if (cleanSql.startsWith('INSERT INTO senders')) {
      const id = this.data.senders.length > 0 ? Math.max(...this.data.senders.map(s => s.id)) + 1 : 1
      this.data.senders.push({ id, name: params[0], email: params[1] })
      this.lastInsertId = id
      this.save()
    } else if (cleanSql.startsWith('INSERT INTO lists')) {
      const id = this.data.lists.length > 0 ? Math.max(...this.data.lists.map(l => l.id)) + 1 : 1
      this.data.lists.push({ id, name: params[0], created_at: params[1] })
      this.lastInsertId = id
      this.save()
    } else if (cleanSql.startsWith('INSERT OR IGNORE INTO list_contacts') || cleanSql.startsWith('INSERT INTO list_contacts')) {
      let listId = params[0]
      let email = params[1]
      if (cleanSql.includes('VALUES (1, ?)')) {
        listId = 1
        email = params[0]
      }
      if (email) {
        const normalizedEmail = email.toLowerCase().trim()
        const exists = this.data.list_contacts.some(lc => lc.list_id === listId && lc.contact_email.toLowerCase().trim() === normalizedEmail)
        if (!exists) {
          this.data.list_contacts.push({ list_id: listId, contact_email: normalizedEmail })
          this.save()
        }
      }
    } else if (cleanSql.startsWith('INSERT OR IGNORE INTO contacts') || cleanSql.startsWith('INSERT OR REPLACE INTO contacts') || cleanSql.startsWith('INSERT OR REPLACE INTO contacts') || cleanSql.startsWith('INSERT INTO contacts')) {
      const isSubscribeQuery = cleanSql.includes('(email, first_name, last_name, company, status, created_at)')
      const email = params[0].toLowerCase().trim()
      const existingIdx = this.data.contacts.findIndex(c => c.email === email)

      // Deduce status: if REPLACE we might want to check the status query param in sql.
      // But we can simplify: if contact exists, preserve status unless explicitly set in params.
      let status = 'subscribed'
      if (existingIdx >= 0) {
        status = this.data.contacts[existingIdx].status
      } else if (params[5] && params[5] !== email) {
        status = params[5]
      }
      // Someone who unsubscribed, complained or hard-bounced before comes back as that, not subscribed.
      const stop = existingIdx < 0 ? this.emailStop(email) : null
      if (stop) status = STOP_STATUS[stop.reason]

      let contact
      if (isSubscribeQuery) {
        contact = {
          email,
          first_name: params[1] || '',
          last_name: params[2] || '',
          job_title: '',
          company: params[3] || '',
          status: 'subscribed',
          created_at: new Date().toISOString(),
        }
      } else {
        contact = {
          email,
          first_name: params[1] || '',
          last_name: params[2] || '',
          job_title: params[3] || '',
          company: params[4] || '',
          status,
          created_at: params[params.length - 1] || new Date().toISOString(),
        }
      }

      if (existingIdx >= 0) {
        // If using INSERT OR IGNORE, we should not overwrite an existing contact!
        if (!cleanSql.startsWith('INSERT OR IGNORE INTO contacts')) {
          // The SQL only carries the built-in columns; custom field values
          // would otherwise be wiped by every re-import or edit.
          const custom = this.data.contacts[existingIdx].custom
          this.data.contacts[existingIdx] = custom ? { ...contact, custom } : contact
          this.save()
        }
      } else {
        this.data.contacts.push(contact)
        this.save()
      }
    } else if (cleanSql.startsWith('INSERT INTO campaigns')) {
      const id = this.data.campaigns.length > 0 ? Math.max(...this.data.campaigns.map(c => c.id)) + 1 : 1
      const hasUnsub = cleanSql.includes('unsubscribe_enabled')
      this.data.campaigns.push({
        id,
        name: params[0],
        subject: params[1],
        preview_text: params[2] || null,
        html_content: params[3],
        list_id: params[4] || null,
        sender_id: params[5] || null,
        status: 'draft',
        unsubscribe_enabled: hasUnsub ? !!params[6] : true,
        created_at: hasUnsub ? (params[7] || new Date().toISOString()) : (params[6] || new Date().toISOString()),
        sent_at: null,
      })
      this.lastInsertId = id
      this.save()
    } else if (cleanSql.startsWith('INSERT OR REPLACE INTO campaign_recipients')) {
      const cid = params[0]
      const email = params[1].toLowerCase().trim()
      let status = params[2]
      if (status === undefined) {
        if (cleanSql.includes("'sent'")) status = 'sent'
        else if (cleanSql.includes("'bounced_soft'")) status = 'bounced_soft'
        else status = 'sent'
      }

      const existingIdx = this.data.campaign_recipients.findIndex(cr => cr.campaign_id === cid && cr.contact_email === email)
      const now = new Date().toISOString()
      const record = {
        campaign_id: cid,
        contact_email: email,
        status,
        opened_at: null,
        clicked_at: null,
        sent_at: now,
        opens: 0,
        clicks: 0,
        ...(status === 'bounced_soft' ? { bounced_at: now } : {}),
      }

      if (existingIdx >= 0) {
        const existing = this.data.campaign_recipients[existingIdx]
        existing.status = status
        existing.sent_at = now
        if (status === 'bounced_soft') existing.bounced_at = now
      } else {
        this.data.campaign_recipients.push(record)
      }
      this.save()
    } else if (cleanSql.startsWith('UPDATE contacts SET status = ? WHERE email = ?')) {
      const email = params[1].toLowerCase().trim()
      const contact = this.data.contacts.find(c => c.email === email)
      if (contact) {
        contact.status = params[0]
        this.save()
      }
    } else if (cleanSql.startsWith('UPDATE campaign_recipients SET status = ? WHERE campaign_id = ? AND contact_email = ?')) {
      const cid = params[1]
      const email = params[2].toLowerCase().trim()
      const record = this.data.campaign_recipients.find(cr => cr.campaign_id == cid && cr.contact_email === email)
      if (record) {
        record.status = params[0]
        this.save()
      }
    } else if (cleanSql.startsWith('UPDATE campaign_recipients SET status = \'opened\', opened_at = ?')) {
      // params: [now, cid, email]
      const cid = params[1]
      const email = params[2].toLowerCase().trim()
      const record = this.data.campaign_recipients.find(cr => cr.campaign_id == cid && cr.contact_email === email)
      if (record) {
        record.status = 'opened'
        record.opened_at = params[0]
        this.save()
      }
    } else if (cleanSql.startsWith('UPDATE campaign_recipients SET status = \'clicked\', clicked_at = ?')) {
      // params: [now, cid, email]
      const cid = params[1]
      const email = params[2].toLowerCase().trim()
      const record = this.data.campaign_recipients.find(cr => cr.campaign_id == cid && cr.contact_email === email)
      if (record) {
        record.status = 'clicked'
        record.clicked_at = params[0]
        this.save()
      }
    } else if (cleanSql.startsWith('UPDATE campaigns SET name = ?')) {
      const hasUnsub = cleanSql.includes('unsubscribe_enabled')
      const id = hasUnsub ? params[8] : params[7]
      const campaign = this.data.campaigns.find(c => c.id == id)
      if (campaign) {
        campaign.name = params[0]
        campaign.subject = params[1]
        campaign.preview_text = params[2]
        campaign.html_content = params[3]
        campaign.list_id = params[4]
        campaign.sender_id = params[5]
        campaign.status = params[6]
        if (hasUnsub) {
          campaign.unsubscribe_enabled = !!params[7]
        }
        this.save()
      }
    } else if (cleanSql.startsWith('UPDATE campaigns SET status = \'sent\', sent_at = ?')) {
      const id = params[1]
      const campaign = this.data.campaigns.find(c => c.id == id)
      if (campaign) {
        campaign.status = 'sent'
        campaign.sent_at = params[0]
        this.save()
      }
    } else if (cleanSql.startsWith('UPDATE senders SET name = ?, email = ? WHERE id = ?')) {
      const sender = this.data.senders.find(s => s.id == params[2])
      if (sender) {
        sender.name = params[0]
        sender.email = params[1]
        this.save()
      }
    } else if (cleanSql.startsWith('DELETE FROM senders WHERE id = ?')) {
      this.data.senders = this.data.senders.filter(s => s.id != params[0])
      this.save()
    } else if (cleanSql.startsWith('DELETE FROM campaigns WHERE id = ?')) {
      this.data.campaigns = this.data.campaigns.filter(c => c.id != params[0])
      this.data.campaign_recipients = this.data.campaign_recipients.filter(cr => cr.campaign_id != params[0])
      this.save()
    } else if (cleanSql.startsWith('DELETE FROM list_contacts WHERE list_id = ? AND contact_email = ?')) {
      const listId = params[0]
      const email = params[1].toLowerCase().trim()
      this.data.list_contacts = this.data.list_contacts.filter(lc => !(lc.list_id == listId && lc.contact_email.toLowerCase().trim() === email))
      this.save()
    } else if (cleanSql.startsWith('DELETE FROM contacts WHERE email = ?')) {
      const email = params[0].toLowerCase().trim()
      this.data.contacts = this.data.contacts.filter(c => c.email.toLowerCase().trim() !== email)
      this.data.list_contacts = this.data.list_contacts.filter(lc => lc.contact_email.toLowerCase().trim() !== email)
      this.data.campaign_recipients = this.data.campaign_recipients.filter(cr => cr.contact_email.toLowerCase().trim() !== email)
      // Notes and tasks about only them go too; a deal's or company's keep, without them.
      if (this.data.activities) {
        this.data.activities = this.data.activities.filter(a => !(a.contact_email === email && !a.deal_id && !a.company_id))
        for (const a of this.data.activities) if (a.contact_email === email) a.contact_email = null
      }
      this.save()
    } else if (cleanSql.startsWith('PRAGMA')) {
      // Ignore
    } else {
      console.warn('Unhandled jsonDb.run query:', cleanSql)
    }
  }

  // Mimics sqlite's db.prepare
  prepare(sql: string) {
    return {
      run: (...params: any[]) => this.run(sql, params)
    }
  }

  // Mimics sqlite's db.query
  query(sql: string) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim()

    return {
      get: (...params: any[]) => {
        if (cleanSql.startsWith('SELECT COUNT(*) as count FROM lists')) {
          return { count: this.data.lists.length }
        }
        if (cleanSql.startsWith('SELECT COUNT(*) as count FROM contacts')) {
          return { count: this.data.contacts.length }
        }
        if (
          cleanSql.startsWith('SELECT * FROM senders WHERE email = ?') || 
          cleanSql.startsWith('SELECT id FROM senders WHERE email = ?') ||
          cleanSql.startsWith('SELECT id FROM senders WHERE LOWER(email) = ?')
        ) {
          return this.data.senders.find(s => s.email.toLowerCase() === params[0].toLowerCase()) || null
        }
        if (cleanSql.startsWith('SELECT last_insert_rowid() as id')) {
          // The id the last INSERT created. (This used to be the size of the
          // biggest of the lists, senders and campaigns tables, so a new
          // campaign in a workspace with more lists than campaigns came back
          // with another campaign's id, or one that doesn't exist.)
          return { id: this.lastInsertId }
        }
        if (cleanSql.startsWith('SELECT c.id, c.name, c.subject')) {
          // getCampaign(id)
          const id = params[0]
          const c = this.data.campaigns.find(camp => camp.id == id)
          if (!c) return null
          const sender = this.data.senders.find(s => s.id == c.sender_id)
          const list = this.data.lists.find(l => l.id == c.list_id)

          return {
            id: c.id,
            name: c.name,
            subject: c.subject,
            previewText: c.preview_text,
            htmlContent: c.html_content,
            status: c.status,
            unsubscribeEnabled: c.unsubscribe_enabled ?? true,
            createdAt: c.created_at,
            sentAt: c.sent_at,
            listId: c.list_id,
            listName: list ? list.name : null,
            senderId: c.sender_id,
            senderName: sender ? sender.name : null,
            senderEmail: sender ? sender.email : null,
          }
        }
        console.warn('Unhandled jsonDb.query().get query:', cleanSql)
        return null
      },
      all: (...params: any[]) => {
        if (cleanSql.startsWith('SELECT l.id, l.name, l.created_at')) {
          // getLists()
          return this.data.lists.map(l => {
            const count = this.data.list_contacts.filter(lc => lc.list_id == l.id).length
            return {
              id: l.id,
              name: l.name,
              createdAt: l.created_at,
              totalContacts: count
            }
          })
        }
        if (cleanSql.startsWith('SELECT email, first_name, last_name, job_title, company, status, created_at FROM contacts')) {
          // getContacts(limit, offset)
          let result = this.data.contacts
          if (params.length >= 2) {
            const limit = params[0]
            const offset = params[1]
            result = result.slice(offset, offset + limit)
          }
          return result
        }
        if (cleanSql.startsWith('SELECT c.email, c.first_name, c.last_name, c.job_title, c.company, c.status, c.created_at FROM contacts c JOIN list_contacts lc')) {
          // getListContacts(listId)
          const listId = params[0]
          const emails = this.data.list_contacts.filter(lc => lc.list_id == listId).map(lc => lc.contact_email)
          return this.data.contacts.filter(c => emails.includes(c.email))
        }
        if (cleanSql.startsWith('SELECT c.id, c.name, c.subject, c.preview_text as previewText, c.status, c.created_at as createdAt, c.sent_at as sentAt, c.list_id as listId')) {
          // getCampaigns()
          return this.data.campaigns.map(c => {
            const sender = this.data.senders.find(s => s.id == c.sender_id)
            const list = this.data.lists.find(l => l.id == c.list_id)
            return {
              id: c.id,
              name: c.name,
              subject: c.subject,
              previewText: c.preview_text,
              status: c.status,
              unsubscribeEnabled: c.unsubscribe_enabled ?? true,
              createdAt: c.created_at,
              sentAt: c.sent_at,
              listId: c.list_id,
              listName: list ? list.name : null,
              senderName: sender ? sender.name : null,
              senderEmail: sender ? sender.email : null,
            }
          })
        }
        if (cleanSql.startsWith('SELECT c.email, c.first_name, c.last_name FROM contacts c JOIN list_contacts lc ON c.email = lc.contact_email WHERE lc.list_id = ? AND c.status = \'subscribed\'') ||
            cleanSql.startsWith('SELECT c.email, c.first_name, c.last_name FROM contacts c JOIN list_contacts lc WHERE lc.list_id = ? AND c.status = \'subscribed\'')) {
          // sendCampaign get active contacts
          const listId = params[0]
          const emails = this.data.list_contacts.filter(lc => lc.list_id == listId).map(lc => lc.contact_email)
          return this.data.contacts.filter(c => emails.includes(c.email) && c.status === 'subscribed')
        }
        if (cleanSql.startsWith('SELECT status, COUNT(*) as count FROM campaign_recipients')) {
          // getCampaignStats
          const cid = params[0]
          const records = this.data.campaign_recipients.filter(cr => cr.campaign_id == cid)
          const counts: Record<string, number> = {}
          for (const r of records) {
            counts[r.status] = (counts[r.status] || 0) + 1
          }
          return Object.keys(counts).map(status => ({ status, count: counts[status] }))
        }
        if (cleanSql.startsWith('SELECT id, name, email FROM senders')) {
          return this.data.senders
        }
        console.warn('Unhandled jsonDb.query().all query:', cleanSql)
        return []
      }
    }
  }

  private seedDefaultData() {
    // 0. Auto-migrate/clean up any corrupted statuses
    let hasCorrupt = false
    for (const c of this.data.contacts) {
      if (c.status === c.email || (c.status && c.status.includes('@'))) {
        c.status = 'subscribed'
        hasCorrupt = true
      }
    }
    if (hasCorrupt) {
      this.save()
      console.log('[JSON DB Migration] Cleaned up corrupted contact statuses')
    }

    // 1. Seed default sender from environment. SMTP_SENDER is optional now that
    // SMTP is only one of several providers, so its absence is normal rather
    // than an error worth logging on every boot.
    const senderStr = env.smtp.sender()
    if (senderStr) {
      const match = senderStr.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/)
      const name = match?.[1] || 'Default Sender'
      // No address means nothing to seed: inventing one would put a sender in
      // the UI that the operator never configured and can't send from.
      const email = match?.[2]?.trim()

      const existingSender = email ? this.data.senders.some(s => s.email === email) : true
      if (email && !existingSender) {
        const id = this.data.senders.length > 0 ? Math.max(...this.data.senders.map(s => s.id)) + 1 : 1
        this.data.senders.push({ id, name, email })
        this.save()
        console.log(`[JSON DB Seeder] Added default sender: ${name} <${email}>`)
      }
    }

    // 2. Seed default list
    if (this.data.lists.length === 0) {
      const listId = 1
      this.data.lists.push({ id: listId, name: 'Default Synced List', created_at: new Date().toISOString() })

      const sampleContacts = [
        { email: 'test@example.com', first_name: 'John', last_name: 'Doe', job_title: 'Developer', company: 'Example Inc' },
        { email: 'hello@example.com', first_name: 'Jane', last_name: 'Smith', job_title: 'Marketing Director', company: 'Innovate LLC' }
      ]

      for (const c of sampleContacts) {
        this.data.contacts.push({
          email: c.email,
          first_name: c.first_name,
          last_name: c.last_name,
          job_title: c.job_title,
          company: c.company,
          status: 'subscribed',
          created_at: new Date().toISOString(),
        })
        this.data.list_contacts.push({ list_id: listId, contact_email: c.email })
      }
      this.save()
      console.log(`[JSON DB Seeder] Created default contact list with ${sampleContacts.length} contacts.`)
    }

    // 3. Seed user from environment
    if (!this.data.users) {
      this.data.users = []
    }
    try {
      const authEmail = env.auth.email()
      const authPass = env.auth.password()
      if (authEmail && authPass) {
        const existing = this.data.users.find(u => u.email.toLowerCase() === authEmail.toLowerCase())
        if (!existing) {
          const hash = hashPassword(authPass)
          this.data.users.push({ email: authEmail, passwordHash: hash, envPasswordHash: hash })
          this.save()
          console.log(`[JSON DB Seeder] Added user from environment: ${authEmail}`)
        } else if (!existing.envPasswordHash) {
          // Seeded before envPasswordHash existed, when every boot synced the
          // password: record the current env value as the baseline.
          if (!verifyPassword(authPass, existing.passwordHash)) existing.passwordHash = hashPassword(authPass)
          existing.envPasswordHash = existing.passwordHash
          this.save()
        } else if (!verifyPassword(authPass, existing.envPasswordHash)) {
          // AUTH_PASSWORD itself changed (e.g. to recover a lost password), so
          // it wins over a password changed in the app.
          existing.passwordHash = existing.envPasswordHash = hashPassword(authPass)
          this.save()
          console.log(`[JSON DB Seeder] Updated password from environment: ${authEmail}`)
        }
      }
    } catch (err: any) {
      console.warn('[JSON DB Seeder] Failed to seed user from env:', err.message)
    }
  }

  // Forms helpers
  getForms() {
    if (!this.data.forms) this.data.forms = []
    return this.data.forms
  }

  getForm(id: string) {
    if (!this.data.forms) return null
    return this.data.forms.find(f => f.id === id) || null
  }

  addForm(data: {
    name: string
    fields: string[]
    list_id: number
    save_to_list_enabled: boolean
    save_to_list_fields: string[]
    welcome_email_enabled: boolean
    welcome_email_subject: string
    welcome_email_body: string
    welcome_email_delay_minutes: number
    sender_id: number | null
  }) {
    if (!this.data.forms) this.data.forms = []
    const id = crypto.randomUUID()
    this.data.forms.push({ ...data, id, created_at: new Date().toISOString() })
    this.save()
    return id
  }

  updateForm(id: string, data: Partial<{
    name: string
    fields: string[]
    list_id: number
    save_to_list_enabled: boolean
    save_to_list_fields: string[]
    welcome_email_enabled: boolean
    welcome_email_subject: string
    welcome_email_body: string
    welcome_email_delay_minutes: number
    sender_id: number | null
  }>) {
    if (!this.data.forms) return
    const idx = this.data.forms.findIndex(f => f.id === id)
    if (idx < 0) return
    this.data.forms[idx] = { ...this.data.forms[idx], ...data }
    this.save()
  }

  deleteForm(id: string) {
    if (!this.data.forms) return
    this.data.forms = this.data.forms.filter(f => f.id !== id)
    if (this.data.form_submissions) {
      this.data.form_submissions = this.data.form_submissions.filter(s => s.form_id !== id)
    }
    this.save()
  }

  // Personas helpers (buyer/ICP personas used to drive prospect search filters)
  getPersonas(): Persona[] {
    if (!this.data.personas) this.data.personas = []
    // Older records may predate newer criteria fields; normalize so callers
    // always see the full criteria shape.
    return this.data.personas.map(p => ({ ...p, criteria: normalizePersonaCriteria(p.criteria) }))
  }

  getPersona(id: string): Persona | null {
    if (!this.data.personas) return null
    const persona = this.data.personas.find(p => p.id === id)
    if (!persona) return null
    return { ...persona, criteria: normalizePersonaCriteria(persona.criteria) }
  }

  addPersona(data: {
    name: string
    description: string
    criteria: PersonaCriteria
    painPoints: string
    valueProp: string
  }) {
    if (!this.data.personas) this.data.personas = []
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    this.data.personas.push({ ...data, criteria: normalizePersonaCriteria(data.criteria), id, created_at: now, updated_at: now })
    this.save()
    return id
  }

  updatePersona(id: string, data: Partial<{
    name: string
    description: string
    criteria: PersonaCriteria
    painPoints: string
    valueProp: string
  }>) {
    if (!this.data.personas) return
    const idx = this.data.personas.findIndex(p => p.id === id)
    if (idx < 0) return
    this.data.personas[idx] = { ...this.data.personas[idx], ...data, updated_at: new Date().toISOString() }
    this.save()
  }

  deletePersona(id: string) {
    if (!this.data.personas) return
    this.data.personas = this.data.personas.filter(p => p.id !== id)
    this.save()
  }

  addFormSubmission(formId: string, contactEmail: string, message?: string) {
    if (!this.data.form_submissions) this.data.form_submissions = []
    this.data.form_submissions.push({ form_id: formId, contact_email: contactEmail, message, submitted_at: new Date().toISOString() })
    this.save()
  }

  getFormSubmissionCount(formId: string) {
    if (!this.data.form_submissions) return 0
    return this.data.form_submissions.filter(s => s.form_id === formId).length
  }

  getFormSubmissions(formId: string) {
    if (!this.data.form_submissions) return []
    const subs = this.data.form_submissions.filter(s => s.form_id === formId)
    subs.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
    return subs.map(s => {
      const contact = this.data.contacts.find(c => c.email.toLowerCase() === s.contact_email.toLowerCase())
      return {
        ...s,
        contact
      }
    })
  }

  // Pending email helpers
  addPendingEmail(contactEmail: string, firstName: string, subject: string, html: string, delayMs: number, from?: string) {
    if (!this.data.pending_emails) this.data.pending_emails = []
    const id = crypto.randomUUID()
    this.data.pending_emails.push({
      id,
      contact_email: contactEmail,
      first_name: firstName,
      subject,
      html,
      from,
      send_after: new Date(Date.now() + delayMs).toISOString(),
      sent: false,
    })
    this.save()
    return id
  }

  getDuePendingEmails() {
    if (!this.data.pending_emails) return []
    const now = new Date().toISOString()
    return this.data.pending_emails.filter(e => !e.sent && e.send_after <= now)
  }

  markPendingEmailSent(id: string, outcome: 'sent' | 'skipped' | 'failed' = 'sent') {
    if (!this.data.pending_emails) return
    const record = this.data.pending_emails.find(e => e.id === id)
    if (record) {
      record.sent = true
      record.outcome = outcome
      this.save()
    }
  }

  /** A failed attempt at a pending email; after `max`, it's given up. Returns whether it was given up. */
  notePendingEmailFailure(id: string, max = 5): boolean {
    const record = this.data.pending_emails?.find(e => e.id === id)
    if (!record) return false
    record.attempts = (record.attempts ?? 0) + 1
    if (record.attempts >= max) {
      record.sent = true
      record.outcome = 'failed'
    }
    this.save()
    return record.outcome === 'failed'
  }

  // Brand kit
  /** Adds to this month's usage counts (see usage.ts). */
  /** Adds to a month's counts and, given its day (YYYY-MM-DD), that day's too. */
  addUsage(month: string, deltas: Partial<Record<UsageCounter, number>>, day?: string) {
    this.data.usage ??= {}
    const row = (this.data.usage[month] ??= {})
    for (const [key, n] of Object.entries(deltas) as Array<[UsageCounter, number]>) {
      if (n) row[key] = (row[key] ?? 0) + n
    }
    if (day) {
      const daily = (this.data.usage_daily ??= {})
      if (!daily[day]) {
        // A new day: drop the ones past keeping.
        const oldest = new Date(Date.parse(`${day}T00:00:00Z`) - DAILY_USAGE_DAYS * 86_400_000).toISOString().slice(0, 10)
        for (const d of Object.keys(daily)) if (d < oldest) delete daily[d]
      }
      const dayRow = (daily[day] ??= {})
      for (const [key, n] of Object.entries(deltas) as Array<[UsageCounter, number]>) {
        if (n) dayRow[key] = (dayRow[key] ?? 0) + n
      }
    }
    this.save()
  }

  getUsage(): Record<string, Partial<Record<UsageCounter, number>>> {
    return this.data.usage ?? {}
  }

  getDailyUsage(): Record<string, Partial<Record<UsageCounter, number>>> {
    return this.data.usage_daily ?? {}
  }

  getSendingDomains(): SendingDomain[] {
    return this.data.sending_domains ?? []
  }

  saveSendingDomains(domains: SendingDomain[]) {
    this.data.sending_domains = domains
    this.save()
  }

  getAllowance(): Allowance | null {
    return this.data.allowance ?? null
  }

  setAllowance(allowance: Allowance | null) {
    this.data.allowance = allowance
    this.save()
  }

  getBrandKit() {
    return this.data.brand_kit ?? null
  }

  saveBrandKit(patch: Record<string, unknown>) {
    const next = { ...(this.data.brand_kit ?? {}), ...patch, updated_at: new Date().toISOString() }
    // Empty strings mean "unset this", so they are dropped rather than stored.
    for (const key of Object.keys(next)) {
      if (next[key as keyof typeof next] === '') delete next[key as keyof typeof next]
    }
    this.data.brand_kit = next as any
    this.save()
    return this.data.brand_kit
  }

  // Email sending settings. Deliberately dumb storage — encryption and the
  // env-var fallback live in emailSettings.ts so this stays crypto-free.
  getEmailSettings() {
    return this.data.email_settings ?? null
  }

  saveEmailSettings(next: NonNullable<DbSchema['email_settings']>) {
    this.data.email_settings = { ...next, updated_at: new Date().toISOString() }
    this.save()
    return this.data.email_settings
  }

  // Copilot chat history
  getCopilotChats() {
    if (!this.data.copilot_chats) this.data.copilot_chats = []
    // Metadata only — transcripts can be long and the list view never shows them.
    return [...this.data.copilot_chats]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(c => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        messageCount: c.messages.length,
      }))
  }

  getCopilotChat(id: string) {
    if (!this.data.copilot_chats) return null
    return this.data.copilot_chats.find(c => c.id === id) ?? null
  }

  /** Insert or replace a chat, keeping `created_at` from the original. */
  saveCopilotChat(chat: {
    id: string
    title: string
    messages: Array<{ role: 'user' | 'assistant'; content: string; isError?: boolean; tools?: Array<{ name: string; status: string }> }>
  }) {
    if (!this.data.copilot_chats) this.data.copilot_chats = []
    const now = new Date().toISOString()
    const index = this.data.copilot_chats.findIndex(c => c.id === chat.id)
    if (index >= 0) {
      this.data.copilot_chats[index] = {
        ...this.data.copilot_chats[index],
        title: chat.title || this.data.copilot_chats[index].title,
        messages: chat.messages,
        updated_at: now,
      }
    } else {
      this.data.copilot_chats.push({
        id: chat.id,
        title: chat.title || 'New chat',
        messages: chat.messages,
        created_at: now,
        updated_at: now,
      })
    }
    this.save()
  }

  deleteCopilotChat(id: string) {
    if (!this.data.copilot_chats) return
    this.data.copilot_chats = this.data.copilot_chats.filter(c => c.id !== id)
    this.save()
  }

  // Survey helpers
  getSurveys(): Survey[] {
    if (!this.data.surveys) this.data.surveys = []
    return this.data.surveys
  }

  getSurvey(id: string): Survey | null {
    return this.data.surveys?.find(s => s.id === id) ?? null
  }

  addSurvey(data: Pick<Survey, 'name' | 'design' | 'settings'>): Survey {
    if (!this.data.surveys) this.data.surveys = []
    const now = new Date().toISOString()
    const survey: Survey = { ...data, id: crypto.randomUUID(), status: 'draft', created_at: now, updated_at: now, published_at: null }
    this.data.surveys.push(survey)
    this.save()
    return survey
  }

  updateSurvey(id: string, patch: Partial<Omit<Survey, 'id' | 'created_at'>>): Survey | null {
    const survey = this.data.surveys?.find(s => s.id === id)
    if (!survey) return null
    Object.assign(survey, patch, { updated_at: new Date().toISOString() })
    this.save()
    return survey
  }

  deleteSurvey(id: string) {
    if (!this.data.surveys) return
    this.data.surveys = this.data.surveys.filter(s => s.id !== id)
    this.data.survey_responses = (this.data.survey_responses ?? []).filter(r => r.survey_id !== id)
    this.save()
  }

  // Email template helpers
  getEmailTemplates(): EmailTemplate[] {
    if (!this.data.email_templates) this.data.email_templates = []
    return this.data.email_templates
  }

  getEmailTemplate(id: string): EmailTemplate | null {
    return this.data.email_templates?.find(t => t.id === id) ?? null
  }

  addEmailTemplate(data: Pick<EmailTemplate, 'name' | 'description' | 'html'>): EmailTemplate {
    if (!this.data.email_templates) this.data.email_templates = []
    const now = new Date().toISOString()
    const template: EmailTemplate = { ...data, id: crypto.randomUUID(), created_at: now, updated_at: now }
    this.data.email_templates.push(template)
    this.save()
    return template
  }

  updateEmailTemplate(id: string, patch: Partial<Pick<EmailTemplate, 'name' | 'description' | 'html'>>): EmailTemplate | null {
    const template = this.data.email_templates?.find(t => t.id === id)
    if (!template) return null
    Object.assign(template, patch, { updated_at: new Date().toISOString() })
    this.save()
    return template
  }

  deleteEmailTemplate(id: string) {
    if (!this.data.email_templates) return
    this.data.email_templates = this.data.email_templates.filter(t => t.id !== id)
    this.save()
  }

  // Survey response helpers
  getSurveyResponses(surveyId: string, opts: { status?: SurveyResponse['status']; includeTest?: boolean } = {}): SurveyResponse[] {
    return (this.data.survey_responses ?? [])
      .filter(r => r.survey_id === surveyId)
      .filter(r => !opts.status || r.status === opts.status)
      .filter(r => opts.includeTest || !r.meta?.test)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
  }

  /** Real (non-test) responses, which is what locks a survey's structure. */
  getSurveyResponseCount(surveyId: string): number {
    return (this.data.survey_responses ?? []).filter(r => r.survey_id === surveyId && !r.meta?.test).length
  }

  getSurveyResponse(id: string): SurveyResponse | null {
    return this.data.survey_responses?.find(r => r.id === id) ?? null
  }

  /** The most recent response from a token-identified respondent. */
  findSurveyResponse(surveyId: string, email: string, campaignId: number | null): SurveyResponse | null {
    const normalized = email.toLowerCase().trim()
    const matches = (this.data.survey_responses ?? []).filter(
      r => r.survey_id === surveyId && r.contact_email === normalized && r.campaign_id === campaignId,
    )
    return matches.sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null
  }

  findSurveyResponseByResumeHash(surveyId: string, hash: string): SurveyResponse | null {
    return this.data.survey_responses?.find(r => r.survey_id === surveyId && r.resume_key_hash === hash) ?? null
  }

  /** Insert or replace by id. */
  saveSurveyResponse(response: SurveyResponse) {
    if (!this.data.survey_responses) this.data.survey_responses = []
    const idx = this.data.survey_responses.findIndex(r => r.id === response.id)
    if (idx >= 0) this.data.survey_responses[idx] = response
    else this.data.survey_responses.push(response)
    this.save()
  }

  deleteSurveyResponse(id: string) {
    if (!this.data.survey_responses) return
    this.data.survey_responses = this.data.survey_responses.filter(r => r.id !== id)
    this.save()
  }

  getSurveyResponsesForContact(email: string): SurveyResponse[] {
    const normalized = email.toLowerCase().trim()
    return (this.data.survey_responses ?? [])
      .filter(r => r.contact_email === normalized && !r.meta?.test)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
  }

  // Custom contact field helpers
  getContactFields(): ContactFieldDef[] {
    if (!this.data.contact_fields) this.data.contact_fields = []
    return this.data.contact_fields
  }

  addContactField(def: Omit<ContactFieldDef, 'created_at'>): ContactFieldDef {
    if (!this.data.contact_fields) this.data.contact_fields = []
    if (this.data.contact_fields.some(f => f.key === def.key)) throw new Error(`A field with key "${def.key}" already exists`)
    const record = { ...def, created_at: new Date().toISOString() }
    this.data.contact_fields.push(record)
    this.save()
    return record
  }

  /** The key is immutable; everything else can change. */
  updateContactField(key: string, patch: Partial<Pick<ContactFieldDef, 'label' | 'options'>>) {
    const field = this.data.contact_fields?.find(f => f.key === key)
    if (!field) throw new Error('Field not found')
    Object.assign(field, patch)
    this.save()
    return field
  }

  /** Removes the definition and the value from every contact. */
  deleteContactField(key: string) {
    if (!this.data.contact_fields) return
    this.data.contact_fields = this.data.contact_fields.filter(f => f.key !== key)
    for (const c of this.data.contacts) {
      if (c.custom && key in c.custom) delete c.custom[key]
    }
    this.save()
  }

  /** Records that someone signed themselves up (see `signed_up_at`). */
  markSignedUp(email: string) {
    const contact = this.data.contacts.find((c) => c.email === email.toLowerCase().trim())
    if (!contact) return
    contact.signed_up_at = new Date().toISOString()
    // Signing up again is new consent.
    this.clearEmailStop(email)
    this.save()
  }

  private stopKey(email: string) {
    return crypto.createHmac('sha256', env.suppressionSecret()).update(`email-stop:${email.toLowerCase().trim()}`).digest('hex')
  }

  /** Don't email this address again (see email_stops); the latest reason wins, except a complaint stays a complaint. */
  stopEmail(email: string, reason: EmailStopReason) {
    const stops = (this.data.email_stops ??= {})
    const key = this.stopKey(email)
    if (stops[key]?.reason === 'complained' && reason !== 'complained') return
    stops[key] = { reason, at: new Date().toISOString() }
    this.save()
  }

  emailStop(email: string): { reason: EmailStopReason; at: string } | null {
    return this.data.email_stops?.[this.stopKey(email)] ?? null
  }

  bouncePollerSince(): string | null {
    return this.data.bounce_poller_since ?? null
  }

  setBouncePollerSince(at: string) {
    this.data.bounce_poller_since = at
    this.save()
  }

  clearEmailStop(email: string) {
    const key = this.stopKey(email)
    if (this.data.email_stops?.[key]) {
      delete this.data.email_stops[key]
      this.save()
    }
  }

  getContact(email: string): ContactRecord | null {
    const normalized = email.toLowerCase().trim()
    return this.data.contacts.find(c => c.email.toLowerCase() === normalized) ?? null
  }

  /**
   * Create or patch a contact without going through the SQL shim.
   *
   * `create: false` only patches an existing contact. Status is never changed
   * on an existing contact — an unsubscribed person answering a survey stays
   * unsubscribed.
   */
  upsertContact(
    email: string,
    patch: { builtin?: Partial<Pick<ContactRecord, 'first_name' | 'last_name' | 'job_title' | 'company'>>; custom?: Record<string, ContactCustomValue> },
    opts: { create: boolean; status?: string },
  ): { contact: ContactRecord | null; created: boolean } {
    const normalized = email.toLowerCase().trim()
    let contact = this.getContact(normalized)
    let created = false
    if (!contact) {
      if (!opts.create) return { contact: null, created: false }
      contact = {
        email: normalized,
        first_name: '',
        last_name: '',
        job_title: '',
        company: '',
        // A sign-up passes its status (new consent); otherwise someone who
        // unsubscribed, complained or hard-bounced before comes back as that.
        status: opts.status ?? (this.emailStop(normalized) ? STOP_STATUS[this.emailStop(normalized)!.reason] : 'subscribed'),
        created_at: new Date().toISOString(),
      }
      this.data.contacts.push(contact)
      created = true
    }
    Object.assign(contact, patch.builtin ?? {})
    if (patch.custom && Object.keys(patch.custom).length) contact.custom = { ...contact.custom, ...patch.custom }
    this.save()
    return { contact, created }
  }

  addContactToList(listId: number, email: string) {
    const normalized = email.toLowerCase().trim()
    if (!this.data.list_contacts.some(lc => lc.list_id === listId && lc.contact_email === normalized)) {
      this.data.list_contacts.push({ list_id: listId, contact_email: normalized })
      this.save()
    }
  }

  private recipientRecord(campaignId: number, email: string) {
    const normalized = email.toLowerCase().trim()
    return this.data.campaign_recipients.find(cr => cr.campaign_id == campaignId && cr.contact_email === normalized)
  }

  /**
   * The email's tracking pixel loaded. Whether a person or a scanner loaded
   * it is judged over all its loads (clickFilter.ts); the status only moves
   * forward (sent → opened) on people's opens, never back from clicked,
   * unsubscribed or a bounce. `automated`: the request said it was a scanner.
   */
  recordOpen(email: string, campaignId: number, opts: { at?: string; automated?: boolean } = {}) {
    const record = this.recipientRecord(campaignId, email)
    if (!record || record.status === 'bounced_hard') return
    const events = this.openEvents(record)
    events.push({ at: opts.at ?? new Date().toISOString(), ...(opts.automated ? { bot: true as const } : {}) })
    if (events.length > MAX_CLICK_EVENTS) {
      const automated = automatedOpens(events, { sentAt: record.sent_at, trappedAt: record.trapped_at })[0]
      const oldest = events.shift()!
      const before = record.opens_before!
      if (automated) before.bots += 1
      else {
        before.opens += 1
        before.first ??= oldest.at
        before.last = oldest.at > (before.last ?? '') ? oldest.at : before.last
      }
    }
    this.judgeOpens(record)
    this.save()
  }

  /** The recipient's open events, starting them (and keeping any counts from before) on first use. */
  private openEvents(record: RecipientRecord): OpenEvent[] {
    if (!record.open_events) {
      record.opens_before = { opens: record.opens ?? (record.opened_at ? 1 : 0), first: record.opened_at ?? null, last: record.last_opened_at ?? record.opened_at ?? null, bots: 0 }
      record.open_events = []
    }
    return record.open_events
  }

  /** Sets the recipient's open counts, first and last open, and status from people's opens only. */
  private judgeOpens(record: RecipientRecord) {
    if (!record.open_events) return
    const before = record.opens_before ?? { opens: 0, first: null, last: null, bots: 0 }
    const automated = automatedOpens(record.open_events, { sentAt: record.sent_at, trappedAt: record.trapped_at })
    const people = record.open_events.filter((_, i) => !automated[i]).map((e) => e.at)
    record.opens = before.opens + people.length
    record.bot_opens = before.bots + (record.open_events.length - people.length)
    const times = [before.first, before.last, ...people].filter((t): t is string => Boolean(t)).sort()
    record.opened_at = times[0] ?? null
    record.last_opened_at = times.at(-1) ?? null
    if (record.opened_at && (record.status === 'sent' || record.status === 'bounced_soft')) record.status = 'opened'
    else if (!record.opened_at && record.status === 'opened') record.status = 'sent'
  }

  /**
   * A tracked link in the email was clicked. Whether it was a person or an
   * automated scanner is judged over all its clicks (clickFilter.ts), so a
   * click counted as a person's can turn out to be a scanner's when the next
   * one arrives. `automated`: the request said it was a scanner or script.
   */
  recordClick(email: string, campaignId: number, url?: string, opts: { at?: string; automated?: boolean } = {}) {
    const record = this.recipientRecord(campaignId, email)
    if (!record || record.status === 'bounced_hard') return
    const events = this.clickEvents(record)
    events.push({ url: url ?? null, at: opts.at ?? new Date().toISOString(), ...(opts.automated ? { bot: true as const } : {}) })
    if (events.length > MAX_CLICK_EVENTS) this.foldOldestClick(record)
    this.judgeClicks(record)
    this.save()
  }

  /** The email's hidden trap link was followed: clicks around then were automated. */
  recordTrap(email: string, campaignId: number, at = new Date().toISOString()) {
    const record = this.recipientRecord(campaignId, email)
    if (!record) return
    record.trapped_at ??= at
    this.clickEvents(record)
    this.judgeClicks(record)
    this.judgeOpens(record)
    this.save()
  }

  /** The recipient's click events, starting them (and keeping any counts from before) on first use. */
  private clickEvents(record: RecipientRecord): ClickEvent[] {
    if (!record.click_events) {
      record.opens ??= record.opened_at ? 1 : 0
      record.clicks_before = { clicks: record.clicks ?? (record.clicked_at ? 1 : 0), links: { ...(record.links ?? {}) }, at: record.clicked_at ?? null, bots: 0 }
      record.click_events = []
    }
    return record.click_events
  }

  /** Moves the oldest click event into the totals from before, as judged now. */
  private foldOldestClick(record: RecipientRecord) {
    const events = record.click_events!
    const automated = automatedClicks(events, { sentAt: record.sent_at, trappedAt: record.trapped_at })[0]
    const oldest = events.shift()!
    const before = record.clicks_before!
    if (automated) before.bots += 1
    else {
      before.clicks += 1
      before.at ??= oldest.at
      if (oldest.url) before.links[oldest.url] = (before.links[oldest.url] ?? 0) + 1
    }
  }

  /** Sets the recipient's click counts, first click and status from people's clicks only. */
  private judgeClicks(record: RecipientRecord) {
    const events = record.click_events ?? []
    const before = record.clicks_before ?? { clicks: 0, links: {}, at: null, bots: 0 }
    const automated = automatedClicks(events, { sentAt: record.sent_at, trappedAt: record.trapped_at })
    const people = events.filter((_, i) => !automated[i])
    record.clicks = before.clicks + people.length
    record.bot_clicks = before.bots + (events.length - people.length)
    const links = { ...before.links }
    for (const e of people) {
      if (!e.url) continue
      if (e.url in links || Object.keys(links).length < MAX_LINKS_PER_RECIPIENT) links[e.url] = (links[e.url] ?? 0) + 1
    }
    record.links = links
    const first = [before.at, ...people.map((e) => e.at)].filter((t): t is string => Boolean(t)).sort()[0] ?? null
    record.clicked_at = first
    // The status only moves as far as people's clicks take it (never back from an unsubscribe or bounce).
    if (first && ['sent', 'opened', 'bounced_soft'].includes(record.status)) record.status = 'clicked'
    else if (!first && record.status === 'clicked') record.status = record.opened_at ? 'opened' : 'sent'
  }

  findUser(email: string) {
    if (!this.data.users) return null
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null
  }

  getUsers() {
    if (!this.data.users) this.data.users = []
    return this.data.users.map(u => ({ email: u.email }))
  }

  addUser(email: string, passwordHash: string) {
    if (!this.data.users) this.data.users = []
    const normalizedEmail = email.toLowerCase().trim()
    if (this.data.users.some(u => u.email.toLowerCase() === normalizedEmail)) {
      throw new Error('User already exists')
    }
    this.data.users.push({ email: normalizedEmail, passwordHash })
    this.save()
  }

  /** Sets a user's password. Returns false when there's no such user. */
  setUserPassword(email: string, passwordHash: string): boolean {
    const user = this.findUser(email)
    if (!user) return false
    user.passwordHash = passwordHash
    this.save()
    return true
  }

  deleteUser(email: string) {
    if (!this.data.users) return
    const normalizedEmail = email.toLowerCase().trim()
    
    // Ensure we don't delete the last remaining user
    if (this.data.users.length <= 1) {
      throw new Error('Cannot delete the last remaining user')
    }

    this.data.users = this.data.users.filter(u => u.email.toLowerCase() !== normalizedEmail)
    this.save()
  }


  /** A spam complaint: unsubscribed straight away, like the unsubscribe link, so they're never emailed again. */
  markComplained(email: string) {
    const normalizedEmail = email.toLowerCase().trim()
    const contact = this.data.contacts.find(c => c.email === normalizedEmail)
    if (contact) contact.status = 'unsubscribed'
    this.stopEmail(normalizedEmail, 'complained')
    const record = this.markRecipientUnsubscribed(normalizedEmail)
    if (record) {
      record.complained_at = new Date().toISOString()
      this.save()
    }
  }

  /** Marks the recipient row unsubscribed and returns it: that campaign's, or else their latest one still open to it. */
  markRecipientUnsubscribed(email: string, campaignId?: string | number) {
    const normalizedEmail = email.toLowerCase().trim()
    let record: RecipientRecord | undefined

    if (campaignId && !isNaN(Number(campaignId))) {
      record = this.data.campaign_recipients.find(cr => cr.campaign_id === Number(campaignId) && cr.contact_email === normalizedEmail)
    } else {
      const records = this.data.campaign_recipients.filter(cr => cr.contact_email === normalizedEmail && ['sent', 'opened', 'clicked'].includes(cr.status))
      records.sort((a, b) => b.campaign_id - a.campaign_id)
      record = records[0]
    }
    if (record) {
      record.status = 'unsubscribed'
      record.unsubscribed_at ??= new Date().toISOString()
    }

    this.save()
    return record
  }

  /**
   * A bounce. Only a hard one (the address doesn't exist) stops future email
   * to the contact; a soft one (mailbox full, server busy, a delay) is only
   * recorded against the email it happened to, so the next campaign tries again.
   */
  updateRecipientBounceStatus(email: string, type: string, campaignId?: string) {
    const normalizedEmail = email.toLowerCase().trim()
    const hard = type === 'hard'

    const contact = this.data.contacts.find(c => c.email === normalizedEmail)
    if (contact && hard) {
      contact.status = 'bounced'
    }
    if (hard) this.stopEmail(normalizedEmail, 'bounced')

    let record: RecipientRecord | undefined
    if (campaignId && !isNaN(Number(campaignId))) {
      record = this.data.campaign_recipients.find(cr => cr.campaign_id === Number(campaignId) && cr.contact_email === normalizedEmail)
    } else {
      // Their latest email: a bounce can arrive after an automatic "open" (Apple Mail prefetches).
      const records = this.data.campaign_recipients.filter(cr => cr.contact_email === normalizedEmail && ['sent', 'opened', 'clicked', 'bounced_soft'].includes(cr.status))
      records.sort((a, b) => b.campaign_id - a.campaign_id)
      record = records[0]
    }
    // A hard bounce is never turned back into a soft one.
    if (record && !(record.status === 'bounced_hard' && !hard)) {
      record.status = hard ? 'bounced_hard' : 'bounced_soft'
      record.bounced_at = new Date().toISOString()
    }

    this.save()
  }

  findSession(id: string) {
    if (!this.data.sessions) {
      this.data.sessions = []
    }
    return this.data.sessions.find(s => s.id === id) || null
  }

  createSession(email: string): string {
    if (!this.data.sessions) {
      this.data.sessions = []
    }
    const id = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    this.data.sessions.push({ id, email, expiresAt })
    this.save()
    return id
  }

  deleteSession(id: string) {
    if (!this.data.sessions) return
    this.data.sessions = this.data.sessions.filter(s => s.id !== id)
    this.save()
  }

  /** Signs a user out everywhere except `keepId` (the session making the change). */
  deleteOtherSessions(email: string, keepId: string) {
    if (!this.data.sessions) return
    const target = email.toLowerCase()
    this.data.sessions = this.data.sessions.filter(s => s.id === keepId || s.email.toLowerCase() !== target)
    this.save()
  }
}

export const db = new JsonDb()

// Placeholder function to maintain schema creation calls in imports
export function initDb() {}


