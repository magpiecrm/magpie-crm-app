// Builds the demo workspace's records (content.ts) as the app stores them,
// without touching the database: seed.ts writes them. Who is who and what
// they did comes from a seeded random generator, so every run makes the same
// people and addresses; dates are counted back from `now`, so the demo always
// looks current. Ids and the proposal's link token are random each run.
//
// Nothing built here can send: campaigns are sent or drafts (never scheduled
// or sending), sequences are paused by hand, and no enrollment is active or
// has a next email due or a draft waiting (see seed.ts for why that's enough).

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DbSchema, EmailStopReason } from '../db'
import type { Activity, Company, Deal, Pipeline, Proposal } from '../../features/sales/types'
import { defaultSettings, type Enrollment, type EnrollmentSend, type Sequence, type SequenceStep, type ThreadMessage } from '../../features/sequences/types'
import { DEFAULT_SURVEY_SETTINGS, DEFAULT_SURVEY_THEME, type Answers, type Survey, type SurveyResponse } from '../../features/survey-builder/types'
import type { EmailTemplate } from '../../features/templates/types'
import type { ContactFieldDef } from '../../features/contacts/contactFields'
import type { FormRecord, FormSubmissionRecord } from '../../features/forms/model'
import type { Persona } from '../../features/prospects/types'
import type { EmailBlock, GlobalStyle } from '../../features/email-builder/types'
import { compileHTML } from '../../features/email-builder/utils/compiler'
import { DEFAULT_GLOBAL_STYLE } from '../../features/email-builder/utils/design'
import { ensurePipelines } from '../sales/pipelines'
import * as C from './content'

type Contact = DbSchema['contacts'][number]
type Recipient = DbSchema['campaign_recipients'][number]
type Campaign = DbSchema['campaigns'][number]
type List = DbSchema['lists'][number]
type Notification = NonNullable<DbSchema['notifications']>[number]
type Fate = 'subscribed' | 'unsubscribed' | 'bounced'

export interface DemoWorkspace {
  sender: { name: string; email: string }
  brandKit: NonNullable<DbSchema['brand_kit']>
  contactFields: ContactFieldDef[]
  contactColumns: NonNullable<DbSchema['contact_columns']>
  contacts: Contact[]
  companies: Company[]
  lists: List[]
  listContacts: DbSchema['list_contacts']
  campaigns: Campaign[]
  recipients: Recipient[]
  sequences: Sequence[]
  enrollments: Enrollment[]
  pipelines: Pipeline[]
  deals: Deal[]
  activities: Activity[]
  proposals: Proposal[]
  personas: Persona[]
  templates: EmailTemplate[]
  forms: FormRecord[]
  formSubmissions: FormSubmissionRecord[]
  formViews: Record<string, Record<string, number>>
  surveys: Survey[]
  surveyResponses: SurveyResponse[]
  notifications: Notification[]
  /** Addresses the app would have stopped emailing (db.stopEmail), for the unsubscribed and bounced. */
  emailStops: Array<{ email: string; reason: EmailStopReason }>
}

interface Person {
  c: Contact
  co: C.DemoCompany
  /** Their place at their company (0: its leader, 1: operations, 2: marketing). */
  i: number
  lists: Set<C.ListKey>
  fate: Fate
  complained: boolean
  /** How keen a reader they are: scales their chance of opening. */
  engagement: number
  /** Kept for a conversation or a deal: never given a bad fate or picked at random. */
  reserved: boolean
  /** The campaign they unsubscribe from. */
  unsubFrom?: string
  attendee: boolean
  demoRequest: boolean
  signedUp: boolean
}

const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000
const SEED = 20261114

/** mulberry32: small, fast and the same everywhere. */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

export function buildDemo({ now, senderId, owner }: { now: Date; senderId: number; owner: string | null }): DemoWorkspace {
  const rand = prng(SEED)
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1))
  const chance = (p: number) => rand() < p
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
  const shuffle = <T>(xs: T[]): T[] => {
    const out = [...xs]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  const t0 = now.getTime()
  /** A time as stored, never later than a minute ago. */
  const at = (ms: number) => new Date(Math.min(ms, t0 - MIN)).toISOString()
  /** `days` ago at `hour`:`minute` UTC, moved back to Friday from a weekend. */
  const dayAt = (days: number, hour: number, minute = 0) => {
    const d = new Date(t0 - days * DAY)
    d.setUTCHours(hour, minute, 0, 0)
    const weekday = d.getUTCDay()
    if (weekday === 6) d.setUTCDate(d.getUTCDate() - 1)
    if (weekday === 0) d.setUTCDate(d.getUTCDate() - 2)
    return d.getTime()
  }
  /** On to Monday from a weekend. */
  const weekday = (ms: number) => {
    const d = new Date(ms)
    const w = d.getUTCDay()
    return w === 6 ? ms + 2 * DAY : w === 0 ? ms + DAY : ms
  }
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)

  // --- People ---------------------------------------------------------------
  const people: Person[] = []
  const usedNames = new Set<string>()
  const usedEmails = new Set<string>()
  const localPart = (f: string, l: string, format: C.DemoCompany['format']) => {
    const [a, b] = [f.toLowerCase(), l.toLowerCase()]
    return format === 'first.last' ? `${a}.${b}` : format === 'first' ? a : format === 'flast' ? `${a[0]}${b}` : `${a}${b[0]}`
  }
  const phoneFor = (country: string): string | undefined => {
    if (!chance(0.65)) return undefined
    // Ofcom's drama numbers, and 555-01xx in the US: never anyone's real line.
    if (country === 'United Kingdom') {
      return chance(0.5) ? `+44 7700 900${pad(int(0, 999), 3)}` : `${pick(['+44 20 7946 0', '+44 117 496 0', '+44 161 496 0', '+44 113 496 0'])}${pad(int(0, 999), 3)}`
    }
    if (country === 'United States') return `+1 (${pick(['212', '415', '312', '617', '503'])}) 555-01${pad(int(0, 99), 2)}`
    return undefined
  }

  const summitImport = dayAt(46, 16)
  const prospectImport = dayAt(88, 10)
  for (const co of C.COMPANIES) {
    const others = shuffle(C.OTHER_TITLES)
    const firstsHere = new Set<string>()
    const lastsHere = new Set<string>()
    for (let i = 0; i < co.people; i++) {
      let first = '', last = '', email = ''
      for (;;) {
        first = pick(C.FIRST_NAMES)
        last = pick(C.LAST_NAMES)
        email = `${localPart(first, last, co.format)}@${co.domain}`
        if (!usedNames.has(`${first} ${last}`) && !firstsHere.has(first) && !lastsHere.has(last) && !usedEmails.has(email)) break
      }
      usedNames.add(`${first} ${last}`)
      usedEmails.add(email)
      firstsHere.add(first)
      lastsHere.add(last)
      const title =
        i === 0 ? pick(co.headcount < 50 ? C.LEAD_TITLES.small : C.LEAD_TITLES.large) : i === 1 ? pick(C.OPS_TITLES) : i === 2 ? pick(C.MARKETING_TITLES) : others[i - 3]
      const phone = phoneFor(co.country)
      const created = co.role === 'customer' ? dayAt(int(120, 330), int(8, 17), int(0, 59)) : co.role === 'prospect' ? prospectImport + people.length * 1000 : dayAt(int(60, 300), int(7, 21), int(0, 59))
      people.push({
        c: {
          email,
          first_name: first,
          last_name: last,
          job_title: title,
          company: co.name,
          status: 'subscribed',
          created_at: at(created),
          country: co.country,
          custom: phone ? { phone } : {},
        },
        co,
        i,
        lists: new Set(),
        fate: 'subscribed',
        complained: false,
        engagement: 0.35 + rand() * 1.3,
        reserved: false,
        attendee: false,
        demoRequest: false,
        signedUp: false,
      })
    }
  }
  const at0 = (p: Person) => Date.parse(p.c.created_at)
  const personAt = (company: string, i: number) => {
    const here = people.filter((p) => p.co.name === company)
    const p = here[Math.min(i, here.length - 1)]
    if (!p) throw new Error(`No demo people at ${company}`)
    return p
  }
  const dealContact = (company: string) => {
    const co = C.COMPANIES.find((c) => c.name === company)!
    return personAt(company, co.role === 'lead' ? 0 : 1)
  }
  const outboundTalkers = C.OUTBOUND_REPLIES.map((r) => personAt(r.company, r.person))
  const webinarTalkers = C.WEBINAR_REPLIES.map((r) => personAt(r.company, r.person))
  for (const p of [...outboundTalkers, ...webinarTalkers, ...C.DEALS.map((d) => dealContact(d.company))]) p.reserved = true
  // Customers' first two people stay subscribed: they're who the account is with.
  for (const p of people) if (p.co.role === 'customer' && p.i < 2) p.reserved = true

  // --- Lists ------------------------------------------------------------------
  for (const p of people) {
    if (p.co.role === 'customer') {
      p.lists.add('customers')
      if (chance(0.55)) p.lists.add('newsletter')
    } else if (p.co.role === 'prospect') {
      p.lists.add('enterprise')
    } else {
      if (chance(0.85)) p.lists.add('newsletter')
      if (chance(0.5)) p.lists.add('summit')
      if (!p.lists.size) p.lists.add('newsletter')
      // Met at the event and nothing before: imported from the stand's scans.
      if (!p.lists.has('newsletter')) p.c.created_at = at(summitImport + people.indexOf(p) * 1000)
    }
  }
  for (const p of webinarTalkers) {
    p.lists.add('newsletter')
    p.lists.delete('summit')
    p.c.created_at = at(dayAt(int(70, 200), 11))
  }
  for (const p of shuffle(people.filter((p) => p.co.role === 'customer' && p.i >= 2)).slice(0, 3)) p.lists.add('summit')

  // Signed up through the newsletter form, over the last few months.
  for (const p of shuffle(people.filter((p) => p.co.role === 'lead' && p.lists.has('newsletter') && !p.lists.has('summit') && !p.reserved)).slice(0, 18)) {
    p.signedUp = true
    const signedUp = t0 - (2 + Math.pow(rand(), 1.4) * 105) * DAY - int(0, 10) * HOUR
    p.c.created_at = at(signedUp)
    p.c.signed_up_at = p.c.created_at
  }

  // Asked for a demo: prospects already imported, and newsletter readers.
  const demoRequesters = [
    ...shuffle(people.filter((p) => p.co.role === 'prospect' && !p.reserved)).slice(0, 5),
    ...shuffle(people.filter((p) => p.co.role === 'lead' && p.lists.has('newsletter') && !p.reserved && !p.signedUp && at0(p) < t0 - 45 * DAY)).slice(0, 4),
  ]
  for (const p of demoRequesters) {
    p.demoRequest = true
    p.lists.add('demo')
  }

  // Registered for the webinar from the invite, and came.
  const invite = C.SENT_CAMPAIGNS.find((c) => c.key === 'webinar-invite')!
  const inviteAt = dayAt(invite.daysAgo, invite.hour)
  const webinarAt = dayAt(31, 13)
  for (const p of people) {
    if (p.lists.has('newsletter') && at0(p) < inviteAt && !p.reserved && chance(0.4)) {
      p.attendee = true
      p.lists.add('webinar')
    }
  }

  // Who unsubscribed (one marked an email as spam) and whose address bounced.
  const free = (p: Person) => !p.reserved && !p.demoRequest && p.co.role !== 'prospect' && p.fate === 'subscribed'
  const take = (n: number, test: (p: Person) => boolean, fate: Fate) => {
    const chosen = shuffle(people.filter((p) => free(p) && test(p))).slice(0, n)
    for (const p of chosen) p.fate = fate
    return chosen
  }
  const newsletterOnly = (p: Person) => p.lists.has('newsletter') && !p.attendee && p.co.role === 'lead'
  take(2, newsletterOnly, 'bounced')
  take(1, (p) => p.lists.has('summit') && !p.lists.has('newsletter'), 'bounced')
  take(3, newsletterOnly, 'unsubscribed')
  take(1, (p) => p.lists.has('summit') && !p.lists.has('newsletter'), 'unsubscribed')
  take(1, (p) => p.co.role === 'customer', 'unsubscribed')
  for (const p of take(1, newsletterOnly, 'unsubscribed')) p.complained = true

  // --- Companies ----------------------------------------------------------------
  const companies: Company[] = C.COMPANIES.map((co) => {
    const first = Math.min(...people.filter((p) => p.co === co).map(at0))
    return {
      id: randomUUID(),
      name: co.name,
      domain: co.domain,
      industry: co.industry,
      headcount: co.headcount,
      linkedin_ref: null,
      owner: co.role === 'lead' ? null : owner,
      notes: co.notes ?? '',
      created_at: at(first),
      updated_at: at(first + int(1, 20) * DAY),
    }
  })
  const companyOf = (name: string) => companies.find((c) => c.name === name)!
  for (const p of people) p.c.company_id = companyOf(p.co.name).id

  // --- Lists and members ---------------------------------------------------------
  const listCreated: Record<C.ListKey, number> = {
    newsletter: dayAt(330, 10),
    customers: dayAt(320, 10),
    webinar: webinarAt + 2 * HOUR,
    enterprise: prospectImport - 5 * MIN,
    summit: summitImport - 5 * MIN,
    demo: dayAt(120, 15),
  }
  const listKeys = Object.keys(C.LISTS) as C.ListKey[]
  const listId = (key: C.ListKey) => listKeys.indexOf(key) + 1
  const lists: List[] = listKeys.map((key) => ({ id: listId(key), name: C.LISTS[key], created_at: at(listCreated[key]) }))
  const listContacts = people.flatMap((p) => [...p.lists].sort().map((key) => ({ list_id: listId(key), contact_email: p.c.email })))

  // --- Email designs ------------------------------------------------------------
  const STYLE: GlobalStyle = {
    ...DEFAULT_GLOBAL_STYLE,
    canvasBgColor: '#f5f1ea',
    buttonBgColor: '#b45309',
    buttonRadius: 6,
    linkColor: '#b45309',
    footerText: C.WORKSPACE.footer,
  }
  const design = (build: (b: ReturnType<typeof blocks>) => EmailBlock[]) => compileHTML(build(blocks()), STYLE)
  const surveyId = randomUUID()

  const campaignBlocks: Record<string, (b: ReturnType<typeof blocks>) => EmailBlock[]> = {
    october: (b) => [
      b.nav(),
      b.title('Reports that send themselves'),
      b.text(
        `${b.hi}\n\nThis month's big one: scheduled reports. Pick a dashboard, choose who gets it and when, and Copperwick sends a clean PDF and a link every week. No more Monday morning exports.\n\nYou can also send a short digest to a Slack channel, so the numbers turn up where your team already talks.`,
      ),
      b.button('See scheduled reports', link('october', 0)),
      b.divider(),
      b.title('Three new templates', 20),
      b.text('• Weekly operations pack: on-time delivery, backlog and staffing on one page\n• Clinic utilisation: appointments, no-shows and chair time by site\n• Marketing pipeline: leads to revenue, by channel and month'),
      b.button('Browse templates', link('october', 1), true),
      b.text("As always, reply to this email if there's a report you wish you had. We read every one.\n\nHannah and the Copperwick team"),
    ],
    'webinar-invite': (b) => [
      b.nav(),
      b.title('Reporting that runs itself'),
      b.text(
        `${b.hi}\n\nJoin us for a 45-minute live session next Thursday at 2pm UK time. We'll build a weekly operations pack from scratch, connect it to three data sources and schedule it, all live.\n\nYou'll see:\n• how Harbourline Freight replaced six hours of Monday exports\n• the five charts every ops review needs (and the three it doesn't)\n• a Q&A with the people who build Copperwick`,
      ),
      b.button('Save my seat', link('webinar-invite', 0)),
      b.text("Can't make it? Register anyway and we'll send you the recording."),
    ],
    'webinar-recording': (b) => [
      b.nav(),
      b.title('Thanks for joining us'),
      b.text(
        `${b.hi}\n\nThank you for coming to Reporting that runs itself. Here's everything from the session: the recording, the slides, and the weekly ops pack template we built live, ready to copy into your workspace.`,
      ),
      b.button('Watch the recording', link('webinar-recording', 0)),
      b.button('Download the slides', link('webinar-recording', 1), true),
      b.text('The question we ran out of time for: yes, scheduled reports can go to people outside your workspace, such as a board or a client. Each gets a read-only link.'),
    ],
    'case-study': (b) => [
      b.nav(),
      b.title('Six hours to forty minutes'),
      b.text(
        `${b.hi}\n\nIt was good to meet you at Ops Summit. One question came up at our stand more than any other: what does this look like for a real operations team? So here's Harbourline Freight's story.\n\nHarbourline run 14 depots. Every Monday their operations team pulled exports from three systems into one spreadsheet, then into slides, before a 10am review. Now the pack builds itself overnight and lands in every depot manager's inbox at 7am.`,
      ),
      b.section(
        [b.text("“We used to spend Monday morning building the report and Monday afternoon arguing about it. Now we spend the meeting on decisions.”\n\nHead of Operations, Harbourline Freight")],
        '#fef3c7',
      ),
      b.button('Read the case study', link('case-study', 0)),
      b.button('Get the Monday pack template', link('case-study', 1), true),
    ],
    'board-packs': (b) => [
      b.nav(),
      b.title('Board packs, built from your dashboards'),
      b.text(
        `${b.hi}\n\nBoard packs are now in every Copperwick workspace. Choose the dashboards, set the meeting date, add a note to each page, and Copperwick builds the pack and sends it to your board a few days before.\n\nNumbers are frozen on the day the pack is sent, so everyone discusses the same figures.`,
      ),
      b.button('How board packs work', link('board-packs', 0)),
      b.divider(),
      b.survey(surveyId),
    ],
    november: (b) => [
      b.nav(),
      b.title('Five reporting habits worth stealing'),
      b.text(
        `${b.hi}\n\nWe looked at how the most organised operations teams we work with run their week. Five habits came up again and again:\n\n1. One page, not twelve. The Monday pack fits on a single screen.\n2. Every number has an owner, named next to it.\n3. Targets live in the report, not in someone's head.\n4. Exceptions first: what moved, then everything else.\n5. The pack arrives before the meeting, not during it.`,
      ),
      b.button('Read the full post', link('november', 0)),
      b.button('Templates that follow all five', link('november', 1), true),
      b.text('See you next month,\nHannah'),
    ],
    december: (b) => [
      b.nav(),
      b.title('A year of Copperwick, in numbers'),
      b.text(`${b.hi}\n\n[Draft: confirm the numbers with product before sending.]\n\n• 2,400 reports sent every week\n• 310 teams on scheduled reports\n• 40 minutes: the median time to build a first dashboard`),
      b.button('See the year in review', `${C.WORKSPACE.site}/blog/year-in-review`),
    ],
    'summit-offer': (b) => [
      b.nav(),
      b.title('Two months on us'),
      b.text(`${b.hi}\n\nThanks again for stopping by our stand at Ops Summit. If you start a Copperwick plan before the end of the year, your first two months are on us.`),
      b.button('Start your plan', `${C.WORKSPACE.site}/pricing?offer=opssummit`),
    ],
  }
  function link(key: string, n: number) {
    return C.SENT_CAMPAIGNS.find((c) => c.key === key)!.links[n]
  }

  // --- Campaigns and what happened to them ---------------------------------------------
  const campaigns: Campaign[] = []
  const recipients: Recipient[] = []
  const current = new Map<Person, Fate>()
  const statusOf = (p: Person) => current.get(p) ?? 'subscribed'
  const sendTime = (c: C.SentCampaign) => dayAt(c.daysAgo, c.hour)
  const sentCampaigns = [...C.SENT_CAMPAIGNS].sort((a, b) => b.daysAgo - a.daysAgo)
  // Unsubscribes from a campaign older than the week sending reputation looks
  // at (sendingReputation.ts WINDOW_DAYS), where one received it, so Settings →
  // Sending shows a healthy workspace rather than one at risk.
  const beforeReputationWeek = (c: C.SentCampaign) => sendTime(c) < t0 - 8 * DAY
  for (const p of people) {
    if (p.fate !== 'unsubscribed') continue
    const theirs = sentCampaigns.filter((c) => p.lists.has(c.list) && at0(p) < sendTime(c))
    const older = theirs.filter(beforeReputationWeek)
    if (theirs.length) p.unsubFrom = pick(older.length ? older : theirs).key
  }
  const campaignId = new Map<string, number>()
  const openedC5 = new Map<Person, number>()
  for (const camp of sentCampaigns) {
    const id = campaigns.length + 1
    campaignId.set(camp.key, id)
    const sentMs = sendTime(camp)
    campaigns.push({
      id,
      name: camp.name,
      subject: camp.subject,
      preview_text: camp.preview,
      html_content: design(campaignBlocks[camp.key]),
      list_id: listId(camp.list),
      sender_id: senderId,
      status: 'sent',
      unsubscribe_enabled: true,
      track_opens: true,
      created_at: at(sentMs - int(2, 6) * DAY - int(0, 5) * HOUR),
      sent_at: at(sentMs),
      scheduled_at: null,
      guess_hold: null,
      daily_pacing: null,
      batches: null,
    })
    const to = people.filter((p) => p.lists.has(camp.list) && at0(p) < sentMs && statusOf(p) === 'subscribed').sort((a, b) => a.c.email.localeCompare(b.c.email))
    let delivered = 0
    let openedAlready = 0
    const mayOpen: Array<{ p: Person; row: Recipient; opened: number; key: number }> = []
    to.forEach((p, n) => {
      const sent = sentMs + n * 1500 + int(0, 900)
      const row: Recipient = { campaign_id: id, contact_email: p.c.email, status: 'sent', opened_at: null, clicked_at: null, sent_at: at(sent), opens: 0, clicks: 0 }
      recipients.push(row)
      if (p.fate === 'bounced') {
        row.status = 'bounced_hard'
        row.bounced_at = at(sent + int(1, 8) * MIN)
        current.set(p, 'bounced')
        return
      }
      if (chance(0.012)) {
        row.status = 'bounced_soft'
        row.bounced_at = at(sent + int(5, 90) * MIN)
        return
      }
      const arrived = sent + int(3, 25) * 1000
      row.delivered_at = at(arrived)
      delivered++
      // Security scanners at work addresses load the images as the email arrives.
      if (chance(0.09)) row.bot_opens = int(1, 2)
      if (chance(0.03)) row.bot_clicks = camp.links.length
      const delay = chance(0.6) ? between(0.1, 6) * HOUR : chance(0.75) ? between(6, 30) * HOUR : between(30, 120) * HOUR
      const opened = arrived + delay
      if (p.fate === 'unsubscribed' && p.unsubFrom === camp.key) {
        current.set(p, 'unsubscribed')
        row.status = 'unsubscribed'
        if (p.complained) {
          row.complained_at = at(arrived + between(1, 20) * HOUR)
          row.unsubscribed_at = row.complained_at
        } else {
          const first = Math.min(opened, t0 - 20 * MIN)
          Object.assign(row, { opened_at: at(first), last_opened_at: at(first), opens: 1, unsubscribed_at: at(first + int(1, 4) * MIN) })
          openedAlready++
        }
        return
      }
      // Weighted sampling key (Efraimidis-Spirakis): keen readers are likelier to be among those who open.
      if (opened < t0 - 10 * MIN) mayOpen.push({ p, row, opened, key: Math.pow(rand(), 1 / p.engagement) })
    })
    // Exactly the campaign's rates, of those it reached, so every report looks like a real one.
    const openers = mayOpen.sort((a, b) => b.key - a.key).slice(0, Math.max(0, Math.round(camp.openRate * delivered) - openedAlready))
    const clickers = new Set(shuffle(openers).slice(0, Math.max(1, Math.round(camp.clickRate * delivered))))
    for (const o of openers) {
      const opens = 1 + (chance(0.35) ? int(1, 3) : 0)
      Object.assign(o.row, {
        status: 'opened',
        opened_at: at(o.opened),
        last_opened_at: at(opens > 1 ? Math.min(o.opened + between(0.2, 48) * HOUR, t0 - 5 * MIN) : o.opened),
        opens,
      })
      if (camp.key === 'board-packs') openedC5.set(o.p, o.opened)
      if (!clickers.has(o)) continue
      const clicks = chance(0.25) ? 2 : 1
      const links: Record<string, number> = {}
      for (let k = 0; k < clicks; k++) {
        const url = pick(camp.links)
        links[url] = (links[url] ?? 0) + 1
      }
      Object.assign(o.row, { status: 'clicked', clicked_at: at(o.opened + int(1, 25) * MIN), clicks, links })
    }
  }

  // --- Sequences ------------------------------------------------------------------
  const sequences: Sequence[] = []
  const enrollments: Enrollment[] = []
  const activities: Activity[] = []
  const notifications: Notification[] = []
  const replies: Array<{ p: Person; at: string; sequence: string }> = []
  const nameOf = (p: Person) => `${p.c.first_name} ${p.c.last_name}`
  const fill = (text: string, p: Person) =>
    text.replace(/\{\{\s*contact\.(first_name|last_name|company)\s*\}\}/g, (_m, key: 'first_name' | 'last_name' | 'company') => p.c[key])
  const stepRows = new Map<string, number>()
  const stepCampaign = (s: Sequence, n: number, first: number) => {
    const step = s.steps[n]
    const existing = stepRows.get(step.id)
    if (existing) return existing
    const id = campaigns.length + 1
    campaigns.push({
      id,
      name: `${s.name}: email ${n + 1}`,
      subject: step.subject ?? '',
      preview_text: null,
      html_content: '',
      list_id: null,
      sender_id: senderId,
      status: 'sequence',
      unsubscribe_enabled: true,
      track_opens: s.settings.track_opens,
      created_at: at(first),
      sent_at: at(first),
      sequence_id: s.id,
      step_id: step.id,
    })
    step.campaign_id = id
    stepRows.set(step.id, id)
    return id
  }

  /**
   * One sequence: everyone's sends (first emails spread over the first days,
   * as the daily cap would), then how each ended. `outcomes` in the order of
   * `enrolled`; a conversation for those who replied.
   */
  const runSequence = (
    name: string,
    steps: typeof C.OUTBOUND_STEPS,
    createdDaysAgo: number,
    enrolled: Person[],
    outcomes: Array<{ status: Enrollment['status']; sends: number; conversation?: C.DemoConversation; reason?: string | null }>,
  ) => {
    const created = dayAt(createdDaysAgo + 1, 15)
    const s: Sequence = {
      id: randomUUID(),
      name,
      sender_id: senderId,
      status: 'paused',
      paused_reason: null,
      auto_paused: null,
      steps: steps.map((st): SequenceStep => ({ id: randomUUID(), delay_days: st.delay, subject: st.subject, body: st.body })),
      settings: { ...defaultSettings('Europe/London'), daily_cap: 8, signature: C.WORKSPACE.signature },
      guess_gate: null,
      next_slot_at: null,
      created_by: owner,
      created_at: at(created),
      updated_at: at(created),
    }
    sequences.push(s)
    const enrolledAt = dayAt(createdDaysAgo, 8, 30)
    let lastActivity = enrolledAt
    enrolled.forEach((p, n) => {
      const outcome = outcomes[n]
      const firstSend = weekday(enrolledAt + Math.floor(n / s.settings.daily_cap) * DAY + (30 + (n % s.settings.daily_cap) * 50 + int(0, 20)) * MIN)
      const sends: EnrollmentSend[] = []
      let t = firstSend
      for (let k = 0; k < outcome.sends; k++) {
        if (k > 0) t = weekday(t + s.steps[k].delay_days * DAY + int(-40, 40) * MIN)
        const cid = stepCampaign(s, k, t)
        const subject = k === 0 ? fill(s.steps[0].subject!, p) : `Re: ${sends[0].subject}`
        sends.push({ step_id: s.steps[k].id, campaign_id: cid, message_id: `<${randomUUID()}@${C.WORKSPACE.domain}>`, subject, at: at(t) })
        recipients.push({ campaign_id: cid, contact_email: p.c.email, status: 'sent', opened_at: null, clicked_at: null, sent_at: at(t), delivered_at: at(t + int(2, 15) * 1000) })
      }
      lastActivity = Math.max(lastActivity, t)
      const lastRow = recipients[recipients.length - 1]
      const e: Enrollment = {
        id: randomUUID(),
        sequence_id: s.id,
        contact_email: p.c.email,
        status: outcome.status,
        stop_reason: outcome.reason ?? null,
        next_step: outcome.sends,
        // Never a next email due: nothing here is waiting to go.
        next_send_at: null,
        claim: null,
        sends,
        attempts: 0,
        replied_at: null,
        reply: null,
        enrolled_at: at(enrolledAt),
        enrolled_by: owner,
      }
      if (outcome.status === 'bounced') {
        delete lastRow.delivered_at
        Object.assign(lastRow, { status: 'bounced_hard', bounced_at: at(t + int(1, 6) * MIN) })
      } else if (outcome.status === 'unsubscribed') {
        Object.assign(lastRow, { status: 'unsubscribed', unsubscribed_at: at(t + int(2, 20) * HOUR) })
      } else if (outcome.status === 'stopped') {
        e.stop_reason = 'Stopped by hand'
      }
      const talk = outcome.conversation
      if (talk) {
        const base = Date.parse(sends[talk.afterStep].at)
        const subject = `Re: ${sends[0].subject}`
        let previous = sends[talk.afterStep].message_id
        const references = sends.map((x) => x.message_id)
        e.messages = talk.messages.map((m, k): ThreadMessage => {
          const id = `<${randomUUID()}@${m.dir === 'in' ? p.co.domain : C.WORKSPACE.domain}>`
          const msg: ThreadMessage = {
            id: randomUUID(),
            direction: m.dir,
            ...(m.dir === 'out' ? { via: 'app' as const } : {}),
            message_id: id,
            in_reply_to: previous,
            references: [...references],
            from: m.dir === 'in' ? p.c.email : C.WORKSPACE.sender.email,
            subject,
            at: at(base + m.hours * HOUR),
            text: m.text,
            ...(m.dir === 'in' ? { seen: !(talk.unseen && k === talk.messages.length - 1) } : {}),
          }
          previous = id
          references.push(id)
          return msg
        })
        const reply = e.messages.find((m) => m.direction === 'in')!
        e.status = 'replied'
        e.stop_reason = null
        e.replied_at = reply.at
        e.reply = { at: reply.at, matched_by: 'thread' }
        lastRow.replied_at = reply.at
        const last = e.messages[e.messages.length - 1]
        if (talk.done) e.inbox_done_at = at(Date.parse(last.at) + int(1, 3) * HOUR)
        lastActivity = Math.max(lastActivity, Date.parse(last.at))
        if (talk.unseen) {
          notifications.push({ id: randomUUID(), type: 'sequence_reply', message: `${nameOf(p)} replied to "${name}"`, contact_email: p.c.email, created_at: reply.at, read: false })
        }
        replies.push({ p, at: reply.at, sequence: name })
      }
      enrollments.push(e)
    })
    s.updated_at = at(lastActivity + int(2, 30) * HOUR)
    return s
  }

  // Outbound: the people who talked, then others at the prospects, each ending one way.
  const outboundOthers = shuffle(people.filter((p) => p.co.role === 'prospect' && !p.reserved && !p.demoRequest)).slice(0, 13)
  const outboundEnds: Array<{ status: Enrollment['status']; sends: number; reason?: string | null }> = [
    { status: 'bounced', sends: 1, reason: 'Their address bounced' },
    { status: 'unsubscribed', sends: 2, reason: 'Unsubscribed' },
    { status: 'paused', sends: 1 },
    { status: 'paused', sends: 2 },
    { status: 'paused', sends: 2 },
    { status: 'stopped', sends: 2 },
    ...Array.from({ length: 7 }, () => ({ status: 'finished' as const, sends: 3 })),
  ]
  outboundOthers[0].fate = 'bounced'
  outboundOthers[1].fate = 'unsubscribed'
  const outbound = [...outboundTalkers, ...outboundOthers]
  // Enrolled in a mixed order, each keeping their own ending.
  const outboundOrder = shuffle(outbound.map((p, n) => ({ p, n })))
  const outboundSeq = runSequence(
    'Outbound: Heads of Operations, Q4',
    C.OUTBOUND_STEPS,
    27,
    outboundOrder.map((x) => x.p),
    outboundOrder.map(({ n }) =>
      n < outboundTalkers.length
        ? { status: 'replied' as const, sends: C.OUTBOUND_REPLIES[n].afterStep + 1, conversation: C.OUTBOUND_REPLIES[n] }
        : outboundEnds[n - outboundTalkers.length],
    ),
  )

  // Webinar follow-up: those who registered but didn't come.
  const noShows = [
    ...webinarTalkers,
    ...shuffle(people.filter((p) => p.lists.has('newsletter') && !p.attendee && !p.reserved && !p.demoRequest && p.fate === 'subscribed' && at0(p) < inviteAt)).slice(0, 7),
  ]
  const webinarEnds = [...Array.from({ length: 6 }, () => ({ status: 'finished' as const, sends: 2 })), { status: 'paused' as const, sends: 1 }]
  const webinarOrder = shuffle(noShows.map((p, n) => ({ p, n })))
  const webinarSeq = runSequence(
    'Webinar follow-up: registered, not attended',
    C.WEBINAR_STEPS,
    28,
    webinarOrder.map((x) => x.p),
    webinarOrder.map(({ n }) =>
      n < webinarTalkers.length
        ? { status: 'replied' as const, sends: C.WEBINAR_REPLIES[n].afterStep + 1, conversation: C.WEBINAR_REPLIES[n] }
        : webinarEnds[n - webinarTalkers.length],
    ),
  )

  // Drafts last, as the newest campaigns.
  for (const d of C.DRAFT_CAMPAIGNS) {
    const created = t0 - d.daysAgo * DAY - int(1, 5) * HOUR
    campaigns.push({
      id: campaigns.length + 1,
      name: d.name,
      subject: d.subject,
      preview_text: d.preview,
      html_content: design(campaignBlocks[d.key]),
      list_id: listId(d.list),
      sender_id: senderId,
      status: 'draft',
      unsubscribe_enabled: true,
      track_opens: true,
      created_at: at(created),
      sent_at: null,
      scheduled_at: null,
    })
  }

  // --- Pipeline, deals, notes and tasks ---------------------------------------------------
  const holder = {} as DbSchema
  ensurePipelines(holder)
  const pipeline = holder.pipelines![0]
  pipeline.created_at = pipeline.updated_at = at(dayAt(130, 9))
  const stageNamed = (name: string) => pipeline.stages.find((s) => s.name === name)!
  const openStages = pipeline.stages.filter((s) => s.kind === 'open').map((s) => s.name)
  const activity = (a: Omit<Activity, 'id'>) => {
    const row: Activity = { id: randomUUID(), ...a }
    activities.push(row)
    return row
  }
  const deals: Deal[] = []
  const proposals: Proposal[] = []
  const dealsByCompany = new Map<string, Deal>()
  for (const d of C.DEALS) {
    const company = companyOf(d.company)
    const contact = dealContact(d.company)
    const stage = stageNamed(d.stage)
    const created = dayAt(d.createdDaysAgo, int(9, 16), int(0, 59))
    const path = stage.kind === 'won' ? [...openStages, 'Won'] : stage.kind === 'lost' ? [...openStages.slice(0, 4), 'Lost'] : openStages.slice(0, openStages.indexOf(d.stage) + 1)
    const end = stage.kind === 'open' ? Math.max(created + HOUR, t0 - between(0.3, Math.min(5, d.createdDaysAgo * 0.3)) * DAY) : t0 + d.closeInDays * DAY
    const times = path.map((_, k) => (k === 0 ? created : created + ((end - created) * k) / (path.length - 1)))
    const deal: Deal = {
      id: randomUUID(),
      name: d.name,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      value: d.value * 100,
      currency: 'GBP',
      company_id: company.id,
      contact_emails: [contact.c.email],
      owner: owner,
      expected_close: ymd(t0 + d.closeInDays * DAY),
      status: stage.kind,
      lost_reason: d.lostReason ?? null,
      position: deals.filter((x) => x.stage_id === stage.id).length,
      stage_entered_at: at(times[times.length - 1]),
      closed_at: stage.kind === 'open' ? null : at(times[times.length - 1]),
      created_at: at(created),
      updated_at: at(times[times.length - 1]),
    }
    deals.push(deal)
    dealsByCompany.set(d.company, deal)
    activity({ kind: 'created', deal_id: deal.id, company_id: company.id, contact_email: null, body: `Created in ${path[0]}`, to_stage: path[0], created_by: owner, created_at: at(created) })
    path.slice(1).forEach((to, k) => {
      const lost = to === 'Lost' && d.lostReason
      activity({
        kind: 'stage_change',
        deal_id: deal.id,
        company_id: company.id,
        contact_email: null,
        body: lost ? `Moved to ${to}: ${d.lostReason}` : `Moved to ${to}`,
        from_stage: path[k],
        to_stage: to,
        created_by: owner,
        created_at: at(times[k + 1]),
      })
    })
    ;(d.notes ?? []).forEach((body, k) => {
      const when = created + ((Math.min(end, t0) - created) * (k + 1)) / ((d.notes?.length ?? 0) + 1)
      activity({ kind: 'note', deal_id: deal.id, company_id: company.id, contact_email: null, body, created_by: owner, created_at: at(when) })
    })
    if (d.stage === 'Proposal sent' && d.company === 'Wrenfield Health') {
      const sent = times[times.length - 1]
      const title = 'Copperwick for Wrenfield Health'
      const first = sent + (t0 - sent) * between(0.1, 0.25)
      const last = sent + (t0 - sent) * between(0.6, 0.85)
      proposals.push({
        id: randomUUID(),
        deal_id: deal.id,
        token: randomBytes(24).toString('base64url'),
        title,
        html: design((b) => [
          b.title(title),
          b.text(`Prepared for ${nameOf(contact)}, ${contact.c.job_title}, Wrenfield Health.`),
          b.divider(),
          b.title('What you told us', 20),
          b.text('Five clinics each report differently. The weekly operations review takes a day to prepare, and finance rebuilds the numbers for the board every month.'),
          b.title('What we propose', 20),
          b.text('• One weekly operations pack across all five clinics, sent every Monday at 7am\n• A monthly board pack built from the same dashboards\n• Onboarding for up to 20 people, and a named contact for the first 90 days'),
          b.section([b.text('Annual plan, five sites: £21,000 a year, invoiced annually.\nIncludes unlimited dashboards, scheduled reports and board packs.')], '#fef3c7'),
          b.text('Questions? Reply to Hannah at hannah@copperwick.example.'),
        ]),
        sent_at: at(sent),
        views: 3,
        first_viewed_at: at(first),
        last_viewed_at: at(last),
        bot_views: 1,
        accepted_at: null,
        accepted_by: null,
        created_by: owner,
        created_at: at(sent - int(2, 20) * HOUR),
        updated_at: at(sent - HOUR),
      })
      activity({ kind: 'proposal', deal_id: deal.id, company_id: company.id, contact_email: null, body: `Link shared: ${title}`, created_by: owner, created_at: at(sent - 1000) })
      activity({ kind: 'proposal', deal_id: deal.id, company_id: company.id, contact_email: null, body: `Opened: ${title}`, created_by: null, created_at: at(first) })
      notifications.push({ id: randomUUID(), type: 'proposal_viewed', message: `${title} was opened again (${deal.name})`, created_at: at(last), read: true })
    }
  }
  for (const r of replies) {
    const deal = dealsByCompany.get(r.p.co.name)
    if (deal && r.at > deal.created_at) {
      activity({ kind: 'email', deal_id: deal.id, company_id: deal.company_id, contact_email: r.p.c.email, body: `${nameOf(r.p)} replied to "${r.sequence}"`, created_by: null, created_at: r.at })
    }
  }
  const today = new Date(t0)
  today.setUTCHours(0, 0, 0, 0)
  for (const task of C.TASKS) {
    const deal = task.company ? dealsByCompany.get(task.company) : undefined
    const due = task.dueInDays === null ? null : today.getTime() + task.dueInDays * DAY + pick([9, 11, 14, 16]) * HOUR
    const done = task.doneDaysAgo !== undefined ? t0 - task.doneDaysAgo * DAY + int(1, 6) * HOUR : null
    const created = Math.min(due ?? t0, t0) - int(2, 6) * DAY
    activity({
      kind: 'task',
      deal_id: deal?.id ?? null,
      company_id: deal?.company_id ?? (task.company ? companyOf(task.company).id : null),
      contact_email: null,
      body: task.body,
      due_at: due === null ? null : new Date(due).toISOString(),
      done_at: done === null ? null : at(done),
      // A reminder for anything already due went out then, so starting the app doesn't send a pile of them.
      reminded_at: due !== null && due <= t0 ? at(due) : null,
      created_by: owner,
      created_at: at(created),
    })
    if (due !== null && due <= t0 && done === null) {
      notifications.push({ id: randomUUID(), type: 'task_due', message: `Due now: ${task.body}${deal ? ` (${deal.name})` : ''}`, created_at: at(due), read: false })
    }
  }
  const harbourline = personAt('Harbourline Freight', 0)
  const saltmarsh = personAt('Saltmarsh Brewing Co.', 0)
  activity({ kind: 'note', deal_id: null, company_id: null, contact_email: harbourline.c.email, body: 'Happy to be a reference customer. Prefers email to calls.', created_by: owner, created_at: at(dayAt(33, 15)) })
  activity({ kind: 'note', deal_id: null, company_id: companyOf('Saltmarsh Brewing Co.').id, contact_email: saltmarsh.c.email, body: 'Usage has dropped since their ops lead left. Check in before the renewal.', created_by: owner, created_at: at(dayAt(8, 10)) })

  // --- Forms ------------------------------------------------------------------------
  const consent = 'I agree to receive emails. I can unsubscribe at any time.'
  const newsletterForm: FormRecord = {
    id: randomUUID(),
    name: 'Newsletter sign-up',
    fields: ['first_name', 'last_name', 'email', 'company', 'consent'],
    field_settings: { last_name: { required: false } },
    list_id: listId('newsletter'),
    save_to_list_enabled: true,
    save_to_list_fields: ['first_name', 'last_name', 'company'],
    // Off: a visitor trying the demo's form gets no email.
    welcome_email_enabled: false,
    welcome_email_subject: 'Welcome to the Copperwick newsletter',
    welcome_email_body: 'Hi {{first_name}},\n\nThanks for signing up. Once a month we send templates, habits and product news for people who run operations. No spam, ever.\n\nHannah',
    welcome_email_delay_minutes: 0,
    sender_id: senderId,
    submit_label: 'Subscribe',
    success_message: "You're on the list. Look out for our next issue.",
    heading: 'The Monday reporting newsletter',
    intro: 'One email a month: templates, habits and product news. No spam.',
    privacy_url: `${C.WORKSPACE.site}/privacy`,
    style: { accent: '#b45309', corners: 'rounded', theme: 'light', font: 'sans', fields: 'outline' },
    created_at: at(dayAt(125, 11)),
    updated_at: at(dayAt(40, 16)),
  }
  const demoForm: FormRecord = {
    id: randomUUID(),
    name: 'Book a demo',
    fields: ['first_name', 'last_name', 'email', 'company', 'job_title', 'message', 'consent'],
    field_settings: { last_name: { required: true }, company: { required: true }, message: { label: 'What would you like to see?' }, consent: { required: false } },
    list_id: listId('demo'),
    save_to_list_enabled: true,
    save_to_list_fields: ['first_name', 'last_name', 'company', 'job_title'],
    welcome_email_enabled: false,
    welcome_email_subject: 'Your Copperwick demo',
    welcome_email_body: "Hi {{first_name}},\n\nThanks for asking for a demo. We'll be in touch within one working day to find a time.",
    welcome_email_delay_minutes: 0,
    sender_id: senderId,
    submit_label: 'Request a demo',
    success_message: "Thanks! We'll email you within one working day to find a time.",
    heading: 'See Copperwick with your own data',
    intro: 'A 30-minute call with someone who has built operations reports for a living.',
    privacy_url: `${C.WORKSPACE.site}/privacy`,
    style: { accent: '#1c1917', corners: 'square', theme: 'light', font: 'sans', fields: 'filled' },
    created_at: at(listCreated.demo),
    updated_at: at(dayAt(60, 10)),
  }
  const pages = ['copperwick.example/blog/five-reporting-habits', 'copperwick.example/templates', 'copperwick.example/', 'copperwick.example/blog/weekly-ops-pack']
  const formSubmissions: FormSubmissionRecord[] = []
  for (const p of people.filter((x) => x.signedUp).sort((a, b) => a.c.created_at.localeCompare(b.c.created_at))) {
    formSubmissions.push({
      id: randomUUID(),
      form_id: newsletterForm.id,
      contact_email: p.c.email,
      submitted_at: p.c.created_at,
      values: { first_name: p.c.first_name, last_name: p.c.last_name, email: p.c.email, company: p.c.company, consent: true },
      consent_text: consent,
      source: chance(0.4) ? { page: pick(pages), utm: { utm_source: 'linkedin', utm_medium: 'social' } } : { page: pick(pages), ...(chance(0.5) ? { referrer: 'duckduckgo.com/' } : {}) },
      outcome: { list_id: listId('newsletter'), new_contact: true },
    })
  }
  const demoTimes = demoRequesters.map(() => t0 - between(1, 40) * DAY).sort((a, b) => a - b)
  demoRequesters.forEach((p, n) => {
    const when = at(demoTimes[n])
    p.c.signed_up_at = when
    formSubmissions.push({
      id: randomUUID(),
      form_id: demoForm.id,
      contact_email: p.c.email,
      submitted_at: when,
      values: { first_name: p.c.first_name, last_name: p.c.last_name, email: p.c.email, company: p.c.company, job_title: p.c.job_title, message: C.DEMO_MESSAGES[n], consent: true },
      consent_text: consent,
      source: { page: 'copperwick.example/demo', referrer: chance(0.5) ? 'copperwick.example/pricing' : 'copperwick.example/' },
      outcome: { list_id: listId('demo'), new_contact: false },
    })
  })
  const lastDemo = demoRequesters[demoRequesters.length - 1]
  notifications.push({ id: randomUUID(), type: 'form_submission', message: `${nameOf(lastDemo)} submitted "${demoForm.name}"`, contact_email: lastDemo.c.email, created_at: at(demoTimes[demoTimes.length - 1]), read: false })
  const formViews: Record<string, Record<string, number>> = { [newsletterForm.id]: {}, [demoForm.id]: {} }
  for (let d = 0; d < 30; d++) {
    const day = ymd(t0 - d * DAY)
    formViews[newsletterForm.id][day] = int(18, 55)
    formViews[demoForm.id][day] = int(5, 19)
  }

  // --- Survey -------------------------------------------------------------------------
  const q = { nps: randomUUID(), ease: randomUUID(), features: randomUUID(), better: randomUUID(), followUp: randomUUID() }
  const featureOptions = ['Dashboards', 'Scheduled reports', 'Board packs', 'Slack digests', 'Templates'].map((label) => ({ id: randomUUID(), label }))
  const page1 = randomUUID()
  const page2 = randomUUID()
  const surveyCreated = sendTime(C.SENT_CAMPAIGNS.find((c) => c.key === 'board-packs')!) - 2 * DAY
  const survey: Survey = {
    id: surveyId,
    name: C.SURVEY_TEXT.name,
    status: 'published',
    design: {
      theme: { ...DEFAULT_SURVEY_THEME, accentColor: '#b45309', submitLabel: 'Send my answers' },
      pages: [
        {
          id: page1,
          title: 'How are we doing?',
          blocks: [
            { id: randomUUID(), type: 'heading', content: 'How are we doing?' },
            { id: randomUUID(), type: 'text', content: C.SURVEY_TEXT.intro },
            { id: q.nps, type: 'nps', question: { title: 'How likely are you to recommend Copperwick to a colleague?', required: true, scale: { min: 0, max: 10, minLabel: 'Not likely', maxLabel: 'Very likely' } } },
            { id: q.ease, type: 'rating', question: { title: 'How easy is it to build a new report?', required: true, scale: { min: 1, max: 5, icon: 'star' } } },
          ],
        },
        {
          id: page2,
          title: 'A little more',
          blocks: [
            { id: q.features, type: 'multiple_choice', question: { title: 'Which parts of Copperwick do you use most?', required: false, options: featureOptions, maxSelect: 3 } },
            { id: q.better, type: 'long_text', question: { title: 'What one thing would make Copperwick more useful to you?', required: false, maxLength: 1000 } },
            { id: q.followUp, type: 'yes_no', question: { title: 'Can we follow up with you about your answers?', required: true } },
          ],
        },
      ],
    },
    settings: { ...DEFAULT_SURVEY_SETTINGS, thankYou: { title: 'Thank you!', message: 'Thanks for helping us make Copperwick better. We read every answer.' } },
    created_at: at(surveyCreated),
    updated_at: at(surveyCreated + 3 * HOUR),
    published_at: at(surveyCreated + 3 * HOUR),
  }
  const npsScore = () => {
    const r = rand()
    return r < 0.5 ? int(9, 10) : r < 0.82 ? int(7, 8) : r < 0.96 ? int(5, 6) : 3
  }
  const answers = (full: boolean): Answers => {
    const nps = npsScore()
    const out: Answers = { [q.nps]: nps, [q.ease]: Math.max(1, Math.min(5, Math.round(nps / 2) - int(0, 1))) }
    if (!full) return out
    out[q.features] = { optionIds: shuffle(featureOptions).slice(0, int(1, 3)).map((o) => o.id) }
    out[q.better] = chance(0.75) ? pick(C.SURVEY_TEXT.improvements) : null
    out[q.followUp] = chance(0.6)
    return out
  }
  const surveyResponses: SurveyResponse[] = []
  const boardPacksId = campaignId.get('board-packs')!
  const respondents = shuffle([...openedC5.keys()]).slice(0, 17)
  respondents.forEach((p, n) => {
    const started = Math.min(openedC5.get(p)! + int(1, 30) * MIN, t0 - between(2, 40) * HOUR)
    const partial = n >= respondents.length - 2
    const finished = started + int(90, 400) * 1000
    surveyResponses.push({
      id: randomUUID(),
      survey_id: surveyId,
      contact_email: p.c.email,
      source: 'email',
      campaign_id: boardPacksId,
      status: partial ? 'partial' : 'completed',
      answers: answers(!partial),
      path: partial ? [page1] : [page1, page2],
      current_page_id: partial ? page2 : null,
      resume_key_hash: null,
      started_at: at(started),
      updated_at: at(partial ? started + int(30, 90) * 1000 : finished),
      completed_at: partial ? null : at(finished),
    })
  })
  for (let n = 0; n < 5; n++) {
    const started = t0 - between(1, 9) * DAY
    surveyResponses.push({
      id: randomUUID(),
      survey_id: surveyId,
      contact_email: null,
      source: 'link',
      campaign_id: null,
      status: 'completed',
      answers: answers(true),
      path: [page1, page2],
      current_page_id: null,
      resume_key_hash: createHash('sha256').update(randomBytes(16)).digest('hex'),
      started_at: at(started),
      updated_at: at(started + int(80, 300) * 1000),
      completed_at: at(started + int(80, 300) * 1000),
    })
  }
  const low = surveyResponses.filter((r) => r.status === 'completed' && typeof r.answers[q.nps] === 'number' && (r.answers[q.nps] as number) <= 6)
  if (low[0]) Object.assign(low[0], { tags: ['follow up'], note: 'Low score: Hannah to call them this week.' })
  const sso = surveyResponses.find((r) => r.answers[q.better] === 'Single sign-on for the whole team.')
  if (sso) Object.assign(sso, { tags: ['feature request'], note: 'Passed to product (SSO).' })
  const latestNamed = surveyResponses.filter((r) => r.contact_email && r.status === 'completed').sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0]
  if (latestNamed) {
    const p = people.find((x) => x.c.email === latestNamed.contact_email)!
    notifications.push({ id: randomUUID(), type: 'survey_response', message: `${nameOf(p)} completed "${survey.name}"`, contact_email: p.c.email, created_at: latestNamed.completed_at!, read: true })
  }

  // --- Custom fields, tags and statuses -------------------------------------------------
  const inDeal = new Set(deals.map((d) => d.contact_emails[0]))
  const replied = new Set(replies.map((r) => r.p.c.email))
  for (const p of people) {
    const tags: string[] = []
    if (p.co.role === 'customer') tags.push('Customer')
    if (p.lists.has('newsletter')) tags.push('Newsletter')
    if (p.attendee) tags.push('Webinar')
    if (p.lists.has('summit')) tags.push('Ops Summit')
    if (p.i === 0 || (p.co.role === 'prospect' && p.i === 1)) tags.push('Decision maker')
    if (p.co.role === 'customer' && p.i === 1) tags.push('Champion')
    if (p.demoRequest && p.co.role === 'lead') tags.push('Trial')
    if (p === saltmarsh) tags.push('Churn risk')
    const lifecycle: (typeof C.LIFECYCLE)[number] =
      p.co.role === 'customer' ? 'Customer' : inDeal.has(p.c.email) ? 'Opportunity' : replied.has(p.c.email) || p.demoRequest ? 'Qualified lead' : p.co.role === 'prospect' || p.lists.has('summit') ? 'Lead' : 'Subscriber'
    const source: (typeof C.LEAD_SOURCES)[number] =
      p.co.role === 'customer' ? pick(['Referral', 'Website form', 'Partner'] as const) : p.co.role === 'prospect' ? 'Import' : p.signedUp ? 'Website form' : !p.lists.has('newsletter') ? 'Event' : pick(['Website form', 'Webinar', 'Referral'] as const)
    p.c.custom = { ...p.c.custom, tags: C.TAGS.filter((t) => tags.includes(t)), lifecycle_stage: lifecycle, lead_source: source }
    p.c.status = p.fate
  }
  const fieldsCreated = at(dayAt(200, 12))
  const contactFields: ContactFieldDef[] = [
    { key: 'phone', label: 'Phone', type: 'text', created_at: fieldsCreated },
    { key: 'tags', label: 'Tags', type: 'multiselect', options: [...C.TAGS], created_at: fieldsCreated },
    { key: 'lifecycle_stage', label: 'Lifecycle stage', type: 'select', options: [...C.LIFECYCLE], created_at: fieldsCreated },
    { key: 'lead_source', label: 'Lead source', type: 'select', options: [...C.LEAD_SOURCES], created_at: fieldsCreated },
  ]

  // --- Templates, personas, brand ------------------------------------------------------
  const templates: EmailTemplate[] = [
    {
      name: 'Monthly newsletter',
      description: 'Our house style: a headline story, a second story and a sign-off from Hannah.',
      html: design((b) => [
        b.nav(),
        b.title('Headline story'),
        b.text(`${b.hi}\n\nOpen with the one thing you most want readers to take away this month. Two or three short paragraphs.`),
        b.button('Read more', `${C.WORKSPACE.site}/blog`),
        b.divider(),
        b.title('Second story', 20),
        b.text('A shorter piece: a template, a customer tip or a product change.'),
        b.text('See you next month,\nHannah'),
      ]),
      days: 140,
    },
    {
      name: 'Product announcement',
      description: 'One feature, why it matters, and one button.',
      html: design((b) => [
        b.nav(),
        b.title('New: feature name'),
        b.text(`${b.hi}\n\nWhat it does in one sentence, then the problem it solves for an operations team.`),
        b.button('See how it works', `${C.WORKSPACE.site}/changelog`),
        b.text('Questions? Reply to this email.'),
      ]),
      days: 90,
    },
    {
      name: 'Event invitation',
      description: 'Webinars and meet-ups: what, when, and a register button.',
      html: design((b) => [
        b.nav(),
        b.title("You're invited"),
        b.text(`${b.hi}\n\nWhat: \nWhen: \nWhere: \n\nOne line on why it's worth their time.`),
        b.button('Register', `${C.WORKSPACE.site}/events`),
        b.text("Can't make it? Register anyway and we'll send you the recording."),
      ]),
      days: 45,
    },
  ].map(({ days, ...t }) => ({ ...t, id: randomUUID(), created_at: at(dayAt(days, 10)), updated_at: at(dayAt(Math.max(3, days - 20), 15)) }))

  const personaAt = at(dayAt(70, 14))
  const personas: Persona[] = [
    {
      id: randomUUID(),
      name: 'Head of Operations, multi-site distribution',
      description: 'Runs day-to-day operations at a UK logistics, wholesale or manufacturing business with several sites, and owns the weekly operations review.',
      criteria: {
        titles: ['Head of Operations', 'Operations Director', 'VP Operations'],
        seniorities: ['head', 'director', 'vp'],
        industries: ['Logistics and Supply Chain', 'Wholesale', 'Industrial Machinery Manufacturing'],
        companySizes: ['51-200', '201-500'],
        country: 'United Kingdom',
        keyword: '',
      },
      painPoints: 'Monday mornings lost to exports and spreadsheets. Every site reports differently, so the review argues about the numbers instead of acting on them.',
      valueProp: 'One weekly operations pack for every site, built and sent automatically from the systems they already use.',
      created_at: personaAt,
      updated_at: personaAt,
    },
    {
      id: randomUUID(),
      name: 'Marketing operations lead, B2B software',
      description: 'Owns reporting for a small B2B software marketing team, usually the person who builds the monthly pipeline report by hand.',
      criteria: {
        titles: ['Marketing Operations Manager', 'Head of Marketing', 'VP Marketing'],
        seniorities: ['head', 'vp', 'manager'],
        industries: ['Software Development', 'IT Services and IT Consulting'],
        companySizes: ['11-50', '51-200'],
        country: 'United States',
        keyword: '',
      },
      painPoints: 'Marketing and sales report from different numbers, and the monthly pipeline report takes two days to reconcile.',
      valueProp: 'One pipeline dashboard both teams trust, with a scheduled monthly report for the leadership team.',
      created_at: personaAt,
      updated_at: at(dayAt(20, 11)),
    },
  ]

  const brandKit: NonNullable<DbSchema['brand_kit']> = {
    name: C.WORKSPACE.name,
    primaryColor: '#b45309',
    accentColor: '#1c1917',
    backgroundColor: '#f5f1ea',
    textColor: '#1c1917',
    fontFamily: 'Helvetica, Arial, sans-serif',
    toneOfVoice: 'Plain, warm and specific. Short sentences, real numbers, no hype. We write like a helpful colleague who has run an operations team.',
    websiteUrl: C.WORKSPACE.site,
    footerAddress: 'Copperwick Ltd, Bristol, United Kingdom',
    updated_at: at(dayAt(150, 10)),
  }

  const emailStops = people.flatMap((p): DemoWorkspace['emailStops'] =>
    p.fate === 'subscribed' ? [] : [{ email: p.c.email, reason: p.fate === 'bounced' ? 'bounced' : p.complained ? 'complained' : 'unsubscribed' }],
  )

  return {
    sender: { ...C.WORKSPACE.sender },
    brandKit,
    contactFields,
    contactColumns: { contacts: ['contact', 'status', 'email', 'company', 'job_title', 'custom:lifecycle_stage', 'custom:tags', 'country', 'created_at'] },
    contacts: people.map((p) => p.c).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    companies,
    lists,
    listContacts,
    campaigns,
    recipients,
    sequences: [outboundSeq, webinarSeq],
    enrollments,
    pipelines: [pipeline],
    deals,
    activities: activities.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    proposals,
    personas,
    templates,
    forms: [newsletterForm, demoForm],
    formSubmissions,
    formViews,
    surveys: [survey],
    surveyResponses,
    notifications: notifications.filter((n) => n.created_at < now.toISOString()).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    emailStops,
  }
}

/** Email builder blocks, in the demo's house style. */
function blocks() {
  let n = 0
  const id = () => `demo-${++n}`
  const site = C.WORKSPACE.site
  return {
    hi: 'Hi {{ contact.first_name | default: "there" }},',
    nav: (): EmailBlock => ({
      id: id(),
      type: 'navigation',
      content: C.WORKSPACE.name,
      url: site,
      links: [
        { id: id(), label: 'Product', url: `${site}/product` },
        { id: id(), label: 'Templates', url: `${site}/templates` },
        { id: id(), label: 'Blog', url: `${site}/blog` },
      ],
      style: { color: '#1c1917', linkColor: '#57534e' },
    }),
    title: (content: string, fontSize?: number): EmailBlock => ({ id: id(), type: 'title', content, ...(fontSize ? { style: { fontSize } } : {}) }),
    text: (content: string): EmailBlock => ({ id: id(), type: 'text', content }),
    button: (content: string, url: string, outline = false): EmailBlock => ({ id: id(), type: 'button', content, url, align: 'left', ...(outline ? { style: { btnVariant: 'outline' as const } } : {}) }),
    divider: (): EmailBlock => ({ id: id(), type: 'divider', content: '', style: { dividerColor: '#e7e5e4' } }),
    section: (children: EmailBlock[], bgColor: string): EmailBlock => ({ id: id(), type: 'section', content: '', children, style: { bgColor, padding: 20, borderRadius: 8 } }),
    survey: (surveyId: string): EmailBlock => ({
      id: id(),
      type: 'survey',
      content: 'Take the 2-minute survey',
      subContent: 'While you are here: how are we doing? Five questions, two minutes.',
      surveyId,
      surveyMode: 'button',
      align: 'left',
    }),
  }
}
