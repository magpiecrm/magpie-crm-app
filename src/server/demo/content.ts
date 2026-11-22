// The made-up workspace the demo seed fills (seed.ts): Copperwick, a small
// SaaS that builds operations teams' weekly reports. Every company, person,
// address and website here is invented; addresses and sites use the reserved
// `.example` domain (RFC 2606), so nothing can reach a real mailbox or site.
// Phone numbers come from ranges set aside for drama: Ofcom's (UK) and 555-01xx (US).

export const WORKSPACE = {
  name: 'Copperwick',
  domain: 'copperwick.example',
  site: 'https://copperwick.example',
  sender: { name: 'Hannah Okafor', email: 'hannah@copperwick.example' },
  signature: 'Hannah Okafor\nHead of Growth, Copperwick',
  footer: 'Copperwick Ltd, Bristol, United Kingdom.\nYou are receiving this because you signed up for updates from Copperwick.',
}

type CompanyRole = 'customer' | 'prospect' | 'lead'

export interface DemoCompany {
  name: string
  domain: string
  industry: string
  headcount: number
  country: string
  role: CompanyRole
  /** How its addresses are made. */
  format: 'first.last' | 'first' | 'flast' | 'firstl'
  /** Contacts to make there. */
  people: number
  notes?: string
}

export const COMPANIES: DemoCompany[] = [
  // Customers
  { name: 'Harbourline Freight', domain: 'harbourline.example', industry: 'Logistics and Supply Chain', headcount: 240, country: 'United Kingdom', role: 'customer', format: 'first.last', people: 7, notes: 'Annual plan since spring. Weekly ops pack goes to 14 depot managers every Monday.' },
  { name: 'Mossgate Studio', domain: 'mossgate.example', industry: 'Design Services', headcount: 18, country: 'United Kingdom', role: 'customer', format: 'first', people: 5 },
  { name: 'Pinecrest Dental Group', domain: 'pinecrestdental.example', industry: 'Hospitals and Health Care', headcount: 130, country: 'United Kingdom', role: 'customer', format: 'flast', people: 7, notes: 'Uses the clinic utilisation template across 9 practices.' },
  { name: 'Larkfield Accountancy', domain: 'larkfield.example', industry: 'Accounting', headcount: 45, country: 'United Kingdom', role: 'customer', format: 'first.last', people: 6 },
  { name: 'Emberlane Software', domain: 'emberlane.example', industry: 'Software Development', headcount: 85, country: 'United States', role: 'customer', format: 'first', people: 7, notes: 'Renewal due next quarter. Champion: their COO.' },
  { name: 'Kade & Visser', domain: 'kadevisser.example', industry: 'Transportation, Logistics, Supply Chain and Storage', headcount: 310, country: 'Netherlands', role: 'customer', format: 'first.last', people: 7 },
  { name: 'Saltmarsh Brewing Co.', domain: 'saltmarshbrewing.example', industry: 'Beverage Manufacturing', headcount: 60, country: 'United States', role: 'customer', format: 'firstl', people: 6 },
  // Prospects (the outbound sequence's targets)
  { name: 'Ravensholt Engineering', domain: 'ravensholt.example', industry: 'Industrial Machinery Manufacturing', headcount: 420, country: 'United Kingdom', role: 'prospect', format: 'first.last', people: 5, notes: 'Three manufacturing sites; reporting done by hand in Excel.' },
  { name: 'Heronbrook Wholesale', domain: 'heronbrook.example', industry: 'Wholesale', headcount: 190, country: 'United Kingdom', role: 'prospect', format: 'flast', people: 5 },
  { name: 'Velden Supply', domain: 'veldensupply.example', industry: 'Wholesale', headcount: 260, country: 'Germany', role: 'prospect', format: 'first.last', people: 4 },
  { name: 'Northgale Energy', domain: 'northgale.example', industry: 'Utilities', headcount: 380, country: 'United Kingdom', role: 'prospect', format: 'first.last', people: 5 },
  { name: 'Wrenfield Health', domain: 'wrenfieldhealth.example', industry: 'Hospitals and Health Care', headcount: 350, country: 'United Kingdom', role: 'prospect', format: 'first.last', people: 5, notes: 'Evaluating us against two others. Decision by the end of the quarter.' },
  { name: 'Stonechat Security', domain: 'stonechat.example', industry: 'IT Services and IT Consulting', headcount: 150, country: 'United States', role: 'prospect', format: 'first', people: 4 },
  { name: 'Brightmoor Housing Trust', domain: 'brightmoor.example', industry: 'Non-profit Organizations', headcount: 220, country: 'United Kingdom', role: 'prospect', format: 'first.last', people: 4 },
  { name: 'Tidewell Outdoor', domain: 'tidewell.example', industry: 'Retail', headcount: 175, country: 'Ireland', role: 'prospect', format: 'flast', people: 4 },
  // Leads (newsletter, webinar, events)
  { name: 'Silverbirch Learning', domain: 'silverbirch.example', industry: 'E-Learning Providers', headcount: 40, country: 'United Kingdom', role: 'lead', format: 'first', people: 5 },
  { name: 'Kilnworth Ceramics', domain: 'kilnworth.example', industry: 'Glass, Ceramics and Concrete Manufacturing', headcount: 70, country: 'United Kingdom', role: 'lead', format: 'first.last', people: 5 },
  { name: 'Glasshouse Media', domain: 'glasshousemedia.example', industry: 'Advertising Services', headcount: 28, country: 'United States', role: 'lead', format: 'first', people: 5 },
  { name: 'Driftwood Travel', domain: 'driftwoodtravel.example', industry: 'Leisure, Travel and Tourism', headcount: 55, country: 'United States', role: 'lead', format: 'firstl', people: 5 },
  { name: 'Juniper Row Interiors', domain: 'juniperrow.example', industry: 'Furniture and Home Furnishings Manufacturing', headcount: 22, country: 'United Kingdom', role: 'lead', format: 'first', people: 4 },
  { name: 'Marlowe Cycle Works', domain: 'marlowecycles.example', industry: 'Retail', headcount: 34, country: 'United States', role: 'lead', format: 'first.last', people: 5 },
  { name: 'Cobalt Fern Analytics', domain: 'cobaltfern.example', industry: 'IT Services and IT Consulting', headcount: 16, country: 'United Kingdom', role: 'lead', format: 'first', people: 4 },
  { name: 'Atelier Roussel', domain: 'atelierroussel.example', industry: 'Design Services', headcount: 12, country: 'France', role: 'lead', format: 'first.last', people: 4 },
  { name: 'Oakhurst Recruitment', domain: 'oakhurstrecruitment.example', industry: 'Staffing and Recruiting', headcount: 65, country: 'United Kingdom', role: 'lead', format: 'flast', people: 6 },
  { name: 'Bramblewood Foods', domain: 'bramblewood.example', industry: 'Food Production', headcount: 140, country: 'United Kingdom', role: 'lead', format: 'first.last', people: 6 },
  { name: 'Solvik Logistik', domain: 'solvik.example', industry: 'Truck Transportation', headcount: 95, country: 'Sweden', role: 'lead', format: 'first.last', people: 5 },
  { name: 'Casa Albero', domain: 'casaalbero.example', industry: 'Hospitality', headcount: 48, country: 'Spain', role: 'lead', format: 'first', people: 5 },
]

export const FIRST_NAMES = [
  'Olivia', 'Amelia', 'Priya', 'Aisha', 'Chloe', 'Grace', 'Sofia', 'Mei', 'Fatima', 'Zara', 'Niamh', 'Ingrid', 'Lucia', 'Elena',
  'Chiamaka', 'Yasmin', 'Rachel', 'Laura', 'Megan', 'Isabel', 'Anya', 'Leah', 'Rosa', 'Freya', 'Tamsin', 'Keisha', 'Hana',
  'Saoirse', 'Marta', 'Nadia', 'Charlotte', 'Ruth', 'Daniel', 'James', 'Oliver', 'Arjun', 'Kwame', 'Tomasz', 'Lucas', 'Mateo',
  'Samuel', 'Ethan', 'Ravi', 'Omar', 'Callum', 'Jonah', 'Felix', 'Hugo', 'Luca', 'Marcus', 'Nathan', 'Rhys', 'Ben', 'Adam',
  'Tariq', 'Kenji', 'Diego', 'Stefan', 'Joel', 'Liam', 'Patrick', 'Viktor', 'Imran', 'Owen',
]

export const LAST_NAMES = [
  'Hart', 'Patel', 'Khan', 'Brennan', 'Walsh', 'Nowak', 'Fischer', 'Moreau', 'Jansen', 'Lindqvist', 'Garcia', 'Rossi', 'Chen',
  'Nakamura', 'Mensah', 'Adeyemi', 'Clarke', 'Hughes', 'Morgan', 'Bennett', 'Doyle', 'Ferreira', 'Kowalski', 'Shah', 'Ahmed',
  'Murphy', 'Lewis', 'Evans', 'Price', 'Turner', 'Reid', 'Quinn', 'Sato', 'Kim', 'Novak', 'Haddad', 'Osei', 'Kaur', 'Byrne',
  'Fletcher', 'Marsh', 'Ellison', 'Pearce', 'Holloway', 'Ashworth', 'Lindgren', 'Varga', 'Romero', 'Dubois', 'Okonkwo',
  'Barker', 'Whitfield', 'Castillo', 'Desai',
]

/** The first person at each company, by its size. */
export const LEAD_TITLES = { small: ['Founder & CEO', 'Co-founder', 'Managing Director'], large: ['Chief Operating Officer', 'Managing Director', 'CEO', 'Chief Financial Officer'] }
export const OPS_TITLES = ['Head of Operations', 'Operations Director', 'VP Operations', 'Head of Business Operations', 'Operations Manager']
export const MARKETING_TITLES = ['Head of Marketing', 'Marketing Director', 'VP Marketing', 'Marketing Operations Manager', 'Marketing Manager']
export const OTHER_TITLES = [
  'Finance Director', 'Head of Customer Success', 'Data Analyst', 'Commercial Director', 'Head of People', 'Revenue Operations Manager',
  'Business Analyst', 'Office Manager', 'Logistics Manager', 'Senior Operations Analyst', 'Customer Experience Lead', 'Head of Finance',
  'Project Manager', 'Product Manager', 'Sales Director', 'Insights Manager',
]

/** Custom contact fields the demo adds, with the values they can hold. */
export const TAGS = ['Customer', 'Newsletter', 'Webinar', 'Ops Summit', 'Decision maker', 'Champion', 'Trial', 'Churn risk'] as const
export const LIFECYCLE = ['Subscriber', 'Lead', 'Qualified lead', 'Opportunity', 'Customer'] as const
export const LEAD_SOURCES = ['Website form', 'Webinar', 'Event', 'Referral', 'Partner', 'Import'] as const

export const LISTS = {
  newsletter: 'Newsletter subscribers',
  customers: 'Customers',
  webinar: 'Q4 webinar attendees',
  enterprise: 'Enterprise prospects',
  summit: 'Ops Summit 2026 leads',
  demo: 'Demo requests',
} as const
export type ListKey = keyof typeof LISTS

/** A sent campaign: when, to which list, and how it went (open and click rates over those it reached). */
export interface SentCampaign {
  key: string
  name: string
  subject: string
  preview: string
  list: ListKey
  daysAgo: number
  hour: number
  openRate: number
  clickRate: number
  links: string[]
}

export const SENT_CAMPAIGNS: SentCampaign[] = [
  {
    key: 'october',
    name: 'October product update',
    subject: "What's new in Copperwick: scheduled reports and Slack digests",
    preview: 'Plus three report templates our customers asked for',
    list: 'newsletter',
    daysAgo: 52,
    hour: 9,
    openRate: 0.32,
    clickRate: 0.05,
    links: ['https://copperwick.example/changelog/scheduled-reports', 'https://copperwick.example/templates'],
  },
  {
    key: 'webinar-invite',
    name: 'Webinar invite: Reporting that runs itself',
    subject: "You're invited: Reporting that runs itself (live, 45 minutes)",
    preview: 'Real examples, a live build and a Q&A with our product team',
    list: 'newsletter',
    daysAgo: 38,
    hour: 10,
    openRate: 0.33,
    clickRate: 0.05,
    links: ['https://copperwick.example/webinars/reporting-that-runs-itself'],
  },
  {
    key: 'webinar-recording',
    name: 'Webinar recording and slides',
    subject: 'Recording and slides: Reporting that runs itself',
    preview: 'The 38-minute recording, the slides and the template we built live',
    list: 'webinar',
    daysAgo: 29,
    hour: 11,
    openRate: 0.38,
    clickRate: 0.08,
    links: ['https://copperwick.example/webinars/reporting-that-runs-itself/recording', 'https://copperwick.example/webinars/reporting-that-runs-itself/slides'],
  },
  {
    key: 'case-study',
    name: 'Case study: Harbourline Freight',
    subject: 'How Harbourline Freight cut weekly reporting from six hours to forty minutes',
    preview: 'And the Monday dashboard template they use across 14 depots',
    list: 'summit',
    daysAgo: 19,
    hour: 9,
    openRate: 0.28,
    clickRate: 0.04,
    links: ['https://copperwick.example/customers/harbourline-freight', 'https://copperwick.example/templates/weekly-ops-pack'],
  },
  {
    key: 'board-packs',
    name: 'Customers: board packs are here',
    subject: 'New for customers: board packs, built from your dashboards',
    preview: 'Pick the dashboards, set the date, and the pack builds itself',
    list: 'customers',
    daysAgo: 11,
    hour: 14,
    openRate: 0.38,
    clickRate: 0.06,
    links: ['https://copperwick.example/help/board-packs'],
  },
  {
    key: 'november',
    name: 'November newsletter',
    subject: 'Five reporting habits worth stealing',
    preview: "What the best ops teams we work with do every Monday (and what they've stopped doing)",
    list: 'newsletter',
    daysAgo: 5,
    hour: 9,
    openRate: 0.31,
    clickRate: 0.04,
    links: ['https://copperwick.example/blog/five-reporting-habits', 'https://copperwick.example/templates'],
  },
]

export const DRAFT_CAMPAIGNS = [
  {
    key: 'december',
    name: 'December newsletter',
    subject: 'A year of Copperwick, in numbers',
    preview: 'What 2,400 weekly reports taught us about operations teams',
    list: 'newsletter' as ListKey,
    daysAgo: 2,
  },
  {
    key: 'summit-offer',
    name: 'Ops Summit follow-up offer',
    subject: 'Your Ops Summit offer: two months on us',
    preview: 'For teams who stopped by our stand. Valid until the end of the year.',
    list: 'summit' as ListKey,
    daysAgo: 1,
  },
]

/** The outbound sequence's and the webinar follow-up's emails. */
export const OUTBOUND_STEPS = [
  {
    delay: 0,
    subject: 'Monday reporting at {{ contact.company }}',
    body:
      "Hi {{ contact.first_name }},\n\nMost operations teams I speak to lose half a day each week pulling numbers together for the Monday meeting: exports from three systems, a spreadsheet, then screenshots into slides.\n\nCopperwick connects to the tools you already use and builds that pack for you every week, without anyone touching a spreadsheet. Harbourline Freight went from six hours to forty minutes.\n\nWould a 20-minute look at how it would work at {{ contact.company }} be useful?",
  },
  {
    delay: 3,
    subject: null,
    body:
      "Hi {{ contact.first_name }},\n\nA quick follow-up in case this got buried. If it helps, I can send over the dashboard template Harbourline use, so you can see what a finished weekly pack looks like before we talk.\n\nShall I send it over?",
  },
  {
    delay: 5,
    subject: null,
    body:
      "Hi {{ contact.first_name }},\n\nI'll leave it here so I'm not cluttering your inbox. If weekly reporting becomes a priority later in the year, reply to this email and I'll pick it up.\n\nThanks for reading.",
  },
]

export const WEBINAR_STEPS = [
  {
    delay: 0,
    subject: 'Sorry we missed you at the webinar',
    body:
      "Hi {{ contact.first_name }},\n\nYou registered for Reporting that runs itself but couldn't make it on the day, which happens to all of us. The recording is 38 minutes, and the first ten cover what most people ask about: building a weekly pack from the tools you already have.\n\nhttps://copperwick.example/webinars/reporting-that-runs-itself/recording\n\nIf you'd rather see it with your own data, reply and I'll set up a short call.",
  },
  {
    delay: 4,
    subject: null,
    body:
      "Hi {{ contact.first_name }},\n\nOne more thing from the webinar: the template library we demoed is now open to everyone, no account needed.\n\nhttps://copperwick.example/templates\n\nHappy to answer any questions.",
  },
]

/**
 * Conversations after a reply: who (company and which of its people),
 * after which email, and the messages that followed (`in` from them, `out`
 * the answer from the app), hours after the email they answer. `done`: marked
 * as needing no answer; `unseen`: their last message not looked at yet.
 */
export interface DemoConversation {
  company: string
  person: number
  afterStep: number
  messages: Array<{ dir: 'in' | 'out'; hours: number; text: string }>
  done?: boolean
  unseen?: boolean
}

export const OUTBOUND_REPLIES: DemoConversation[] = [
  {
    company: 'Wrenfield Health',
    person: 1,
    afterStep: 0,
    messages: [
      { dir: 'in', hours: 5, text: "Hi Hannah,\n\nTiming is good, actually: we're reviewing how we put the weekly ops pack together next month. Could you do Thursday afternoon? I'll bring our finance lead, who owns most of the exports.\n\nThanks" },
      { dir: 'out', hours: 7, text: "Thursday at 2pm works well. I've sent an invite for 30 minutes so there's time for your finance lead's questions.\n\nLooking forward to it." },
      { dir: 'in', hours: 26, text: 'Perfect, see you then.' },
    ],
    done: true,
  },
  {
    company: 'Ravensholt Engineering',
    person: 1,
    afterStep: 1,
    messages: [
      { dir: 'in', hours: 20, text: 'Yes please, send the template over. What would pricing look like for three sites? Each has its own ERP instance, if that matters.' },
    ],
    unseen: true,
  },
  {
    company: 'Northgale Energy',
    person: 0,
    afterStep: 0,
    messages: [
      { dir: 'in', hours: 30, text: "Thanks for reaching out. We built something in-house last year, so it's not a priority right now. Maybe check back in the spring?" },
      { dir: 'out', hours: 33, text: "Understood, thanks for letting me know. I'll check back in the spring. If the in-house tool ever becomes a burden to maintain, you know where I am." },
    ],
  },
  {
    company: 'Heronbrook Wholesale',
    person: 1,
    afterStep: 1,
    messages: [
      { dir: 'in', hours: 4, text: 'Interesting. Does it work with Business Central? That is where all of our stock data lives.' },
    ],
    unseen: true,
  },
  {
    company: 'Brightmoor Housing Trust',
    person: 1,
    afterStep: 2,
    messages: [
      { dir: 'in', hours: 48, text: "Sorry for the slow reply. I'm not the right person for this any more; our new Head of Operations starts in January. I'll pass your details on." },
    ],
  },
]

export const WEBINAR_REPLIES: DemoConversation[] = [
  {
    company: 'Glasshouse Media',
    person: 0,
    afterStep: 0,
    messages: [
      { dir: 'in', hours: 18, text: 'Thanks, watched it on the train this morning. The scheduled reports part is exactly what we need. Can we talk next week?' },
      { dir: 'out', hours: 20, text: "Great to hear. Does Tuesday at 11 work? I'll show you the scheduled reports with a sample of your own data." },
      { dir: 'in', hours: 23, text: 'Tuesday at 11 is good.' },
    ],
    done: true,
  },
  {
    company: 'Kilnworth Ceramics',
    person: 1,
    afterStep: 0,
    messages: [
      { dir: 'in', hours: 6, text: 'Could you send me the slides as well? I want to share them with our MD.' },
      { dir: 'out', hours: 8, text: "Of course, here they are: https://copperwick.example/webinars/reporting-that-runs-itself/slides\n\nHappy to join a call with your MD if that's useful." },
    ],
  },
  {
    company: 'Cobalt Fern Analytics',
    person: 0,
    afterStep: 1,
    messages: [
      { dir: 'in', hours: 3, text: "We're a team of four. Is there a plan for small teams, or is it priced per seat?" },
    ],
    unseen: true,
  },
]

/** Deals: at which company, in which stage, worth how much (pounds), and how old. */
export const DEALS: Array<{
  company: string
  name: string
  stage: string
  value: number
  createdDaysAgo: number
  closeInDays: number
  lostReason?: string
  notes?: string[]
}> = [
  { company: 'Harbourline Freight', name: 'Harbourline Freight: annual plan', stage: 'Won', value: 18_000, createdDaysAgo: 96, closeInDays: -40, notes: ['Signed for 12 months, paid annually. Rollout to all 14 depots by the end of the month.'] },
  { company: 'Mossgate Studio', name: 'Mossgate Studio: Team plan', stage: 'Won', value: 4_800, createdDaysAgo: 58, closeInDays: -25 },
  { company: 'Tidewell Outdoor', name: 'Tidewell Outdoor: pilot', stage: 'Lost', value: 9_600, createdDaysAgo: 64, closeInDays: -12, lostReason: 'Staying with spreadsheets for now', notes: ['Budget moved to the new e-commerce platform. Revisit after their peak season.'] },
  { company: 'Ravensholt Engineering', name: 'Ravensholt Engineering: three sites', stage: 'Negotiation', value: 32_500, createdDaysAgo: 22, closeInDays: 14, notes: ['Wants one dashboard per site plus a group roll-up. Asked about SSO.', 'Procurement needs our security questionnaire back by Friday.'] },
  { company: 'Wrenfield Health', name: 'Wrenfield Health: ops reporting rollout', stage: 'Proposal sent', value: 21_000, createdDaysAgo: 24, closeInDays: 21, notes: ['Call went well. Their finance lead owns the exports and is keen; the COO signs off.'] },
  { company: 'Kade & Visser', name: 'Kade & Visser: two more depots', stage: 'Proposal sent', value: 12_400, createdDaysAgo: 30, closeInDays: 18 },
  { company: 'Emberlane Software', name: 'Emberlane Software: renewal', stage: 'Negotiation', value: 9_800, createdDaysAgo: 35, closeInDays: 40, notes: ['Asking for a two-year price. Fine if they pay annually upfront.'] },
  { company: 'Heronbrook Wholesale', name: 'Heronbrook Wholesale: annual plan', stage: 'Meeting booked', value: 14_400, createdDaysAgo: 12, closeInDays: 45 },
  { company: 'Stonechat Security', name: 'Stonechat Security: Team plan', stage: 'Meeting booked', value: 7_200, createdDaysAgo: 9, closeInDays: 35 },
  { company: 'Velden Supply', name: 'Velden Supply: pilot', stage: 'Meeting booked', value: 6_000, createdDaysAgo: 15, closeInDays: 30 },
  { company: 'Brightmoor Housing Trust', name: 'Brightmoor Housing Trust', stage: 'Contacted', value: 8_400, createdDaysAgo: 20, closeInDays: 75 },
  { company: 'Northgale Energy', name: 'Northgale Energy: ops dashboards', stage: 'Contacted', value: 16_000, createdDaysAgo: 26, closeInDays: 120 },
  { company: 'Silverbirch Learning', name: 'Silverbirch Learning', stage: 'New lead', value: 3_600, createdDaysAgo: 6, closeInDays: 50 },
  { company: 'Bramblewood Foods', name: 'Bramblewood Foods: production reporting', stage: 'New lead', value: 10_800, createdDaysAgo: 3, closeInDays: 60 },
]

/** Tasks: what, on which deal (by company), and when due in days from now (null: no date); `doneDaysAgo` for finished ones. */
export const TASKS: Array<{ body: string; company?: string; dueInDays: number | null; doneDaysAgo?: number }> = [
  { body: 'Send the security questionnaire back to procurement', company: 'Ravensholt Engineering', dueInDays: 1 },
  { body: 'Follow up on the proposal with their COO', company: 'Wrenfield Health', dueInDays: 2 },
  { body: 'Prepare a Business Central demo with sample stock data', company: 'Heronbrook Wholesale', dueInDays: 3 },
  { body: 'Send two-year pricing options', company: 'Emberlane Software', dueInDays: -1 },
  { body: 'Book the kick-off call for the two new depots', company: 'Kade & Visser', dueInDays: 6 },
  { body: 'Check in after their peak season', company: 'Tidewell Outdoor', dueInDays: 75 },
  { body: 'Draft the December newsletter', dueInDays: 4 },
  { body: 'Review Ops Summit leads who opened the case study', dueInDays: null },
  { body: 'Send the weekly ops pack template', company: 'Ravensholt Engineering', dueInDays: -6, doneDaysAgo: 5 },
  { body: 'Confirm Tuesday call and send the invite', company: 'Stonechat Security', dueInDays: -3, doneDaysAgo: 3 },
  { body: 'Onboarding session for the Mossgate team', company: 'Mossgate Studio', dueInDays: -10, doneDaysAgo: 9 },
]

/** Answers to the "Book a demo" form's message field. */
export const DEMO_MESSAGES = [
  'We run weekly ops reviews across four sites and the prep takes most of Monday morning. Keen to see how the scheduled packs work.',
  'Looking for something to replace a pile of spreadsheets for our board reporting. Could we see it with Xero data?',
  'Saw your talk at Ops Summit. We have about 30 people who need a weekly view of on-time delivery.',
  'Our marketing and ops teams report from different numbers. Want to see if Copperwick could give us one version.',
  'Just exploring for now, but a demo in the next couple of weeks would be great.',
  'Interested in the board packs feature. We present to trustees every quarter.',
  'Can it pull from Shopify and our warehouse system at the same time?',
  'Comparing a few tools before the new financial year. Pricing for around 15 users please.',
  'A colleague at Harbourline recommended you.',
]

export const SURVEY_TEXT = {
  name: 'Customer feedback: Q4',
  intro: "Two minutes, five questions. Your answers go straight to our product team, and we read every one.",
  improvements: [
    'More chart types in board packs, especially waterfall charts.',
    'A way to comment on a number inside the dashboard.',
    'Faster loading on the big depot dashboard on Monday mornings.',
    'Let us schedule different packs to different people from one dashboard.',
    'Better Excel export. Finance still wants the raw numbers.',
    'Single sign-on for the whole team.',
    'Honestly it does what we need. Maybe a mobile view.',
    'Templates for healthcare clinics.',
    'Alerts when a number moves more than a set amount.',
    'Connect to our HR system for headcount reporting.',
  ],
}
