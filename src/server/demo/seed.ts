// Fills a workspace with the made-up Copperwick demo (content.ts, build.ts),
// for a demo copy, before its app starts:
//
//   DATABASE_PATH=/data/local_db.json bun src/server/demo/seed.ts [--reset]
//
// It won't touch a database that already has business data (contacts other
// than the app's two sample ones, campaigns, sequences, deals, forms,
// surveys, templates or personas) unless given --reset. Either way it
// replaces the collections it seeds and leaves everything else as it is:
// users, sessions, API keys, secrets, settings, prospecting caches, usage,
// mailboxes and sending domains. Its own sender and brand kit are added or
// updated; anyone else's are kept.
//
// Nothing it writes is due to send. Campaigns are 'sent' or 'draft', never
// 'scheduled' or 'sending' (the email scheduler only picks up those two).
// Sequences are paused by hand (auto_paused null, so the engine never resumes
// them) and no enrollment is 'active' or has a next_send_at: the engine and
// the AI's draft writer only look at active enrollments with a due
// next_send_at, so even resuming a sequence sends nothing. No enrollment
// drafts, forms' welcome emails off, and welcome emails still waiting from
// before a --reset are dropped (their contacts are gone).

import { existsSync, readFileSync } from 'node:fs'
import { buildDemo } from './build'
import { WORKSPACE } from './content'

/** The sample contacts the app adds to a fresh database (db.ts seedDefaultData): not anyone's data. */
const APP_SAMPLES = new Set(['test@example.com', 'hello@example.com'])

/** Collections that, holding anything, mean someone has used this workspace. */
const IN_USE = ['campaigns', 'sequences', 'deals', 'forms', 'surveys', 'email_templates', 'personas'] as const

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const unknown = args.filter((a) => a !== '--reset')
if (unknown.length) fail(`Unknown argument ${unknown.join(' ')}. Usage: DATABASE_PATH=/data/local_db.json bun src/server/demo/seed.ts [--reset]`)
const reset = args.includes('--reset')

// Without it the app falls back to ./local_db.json, which in a checkout can be someone's real data.
const path = process.env.DATABASE_PATH
if (!path) fail('Set DATABASE_PATH to the demo database file: the seed never guesses which database to fill.')

// Read before the app's db module loads: on a file it can't parse, that starts afresh and would overwrite it.
if (existsSync(path)) {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    fail(`${path} isn't readable JSON (${(err as Error).message}). Nothing was changed.`)
  }
  // A sequence step's hidden campaign row isn't a campaign anyone made.
  const rows = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as Array<{ sequence_id?: unknown }>) : []).filter((r) => key !== 'campaigns' || !r.sequence_id)
  const contacts = rows('contacts').filter((c) => !APP_SAMPLES.has(String((c as { email?: unknown }).email ?? '').toLowerCase())).length
  const found = [...(contacts ? [`${contacts} contacts`] : []), ...IN_USE.filter((k) => rows(k).length).map((k) => `${rows(k).length} ${k.replace('_', ' ')}`)]
  if (found.length && !reset) {
    fail(`${path} already has ${found.join(', ')}. Run with --reset to replace the workspace's data with the demo (users, sessions, keys and settings are kept).`)
  }
}

const { db } = await import('../db')

const sender = db.data.senders.find((s) => s.email.toLowerCase() === WORKSPACE.sender.email)
const senderId = sender?.id ?? Math.max(0, ...db.data.senders.map((s) => s.id)) + 1
const demo = buildDemo({ now: new Date(), senderId, owner: db.data.users[0]?.email ?? null })

let stopsWritten = true
db.transaction(() => {
  db.mutate((data) => {
    if (sender) sender.name = demo.sender.name
    else data.senders.push({ id: senderId, ...demo.sender })
    if (!data.brand_kit || data.brand_kit.name === WORKSPACE.name) data.brand_kit = demo.brandKit

    data.contact_fields = demo.contactFields
    data.contact_columns = demo.contactColumns
    data.contacts = demo.contacts
    data.companies = demo.companies
    data.lists = demo.lists
    data.list_contacts = demo.listContacts
    data.campaigns = demo.campaigns
    data.campaign_recipients = demo.recipients
    data.sequences = demo.sequences
    data.sequence_enrollments = demo.enrollments
    data.pipelines = demo.pipelines
    data.deals = demo.deals
    data.activities = demo.activities
    data.proposals = demo.proposals
    data.personas = demo.personas
    data.email_templates = demo.templates
    data.forms = demo.forms
    data.form_submissions = demo.formSubmissions
    data.form_views = demo.formViews
    data.surveys = demo.surveys
    data.survey_responses = demo.surveyResponses
    data.notifications = demo.notifications
    // Welcome emails still waiting were for contacts that are now gone.
    data.pending_emails = (data.pending_emails ?? []).filter((e) => e.sent)
  })
  // Who unsubscribed or bounced is also kept by keyed hash, as the app does,
  // so re-importing them wouldn't email them again. A re-seed starts the
  // demo's own addresses afresh; anyone else's stay stopped.
  try {
    for (const c of demo.contacts) db.clearEmailStop(c.email)
    for (const s of demo.emailStops) db.stopEmail(s.email, s.reason)
  } catch (err) {
    stopsWritten = false
    console.warn(`Skipped the email stops (${(err as Error).message}); contacts' statuses still say who unsubscribed or bounced.`)
  }
})()

// Counted from the file, so this also shows the data reached the disk.
const saved = JSON.parse(readFileSync(path, 'utf8')) as typeof db.data
const n = (rows: unknown[] | undefined) => rows?.length ?? 0
const campaigns = saved.campaigns.filter((c) => !c.sequence_id)
const due = [
  ...saved.campaigns.filter((c) => c.status === 'scheduled' || c.status === 'sending').map((c) => `campaign "${c.name}" is ${c.status}`),
  ...(saved.sequence_enrollments ?? []).filter((e) => e.status === 'active' || e.next_send_at || e.claim || Object.keys(e.drafts ?? {}).length).map((e) => `enrollment ${e.id} could send`),
  ...(saved.pending_emails ?? []).filter((e) => !e.sent).map((e) => `pending email ${e.id} is unsent`),
]
console.log(
  [
    `Seeded ${n(saved.contacts)} contacts at ${n(saved.companies)} companies, ${n(saved.lists)} lists (${n(saved.list_contacts)} memberships),`,
    `${campaigns.filter((c) => c.status === 'sent').length} sent and ${campaigns.filter((c) => c.status === 'draft').length} draft campaigns (${n(saved.campaign_recipients)} recipient rows, sequences' included),`,
    `${n(saved.sequences)} sequences (${n(saved.sequence_enrollments)} enrollments, ${(saved.sequence_enrollments ?? []).filter((e) => e.messages?.length).length} conversations),`,
    `${n(saved.deals)} deals in ${n(saved.pipelines)} pipeline, ${n(saved.activities)} activities (${(saved.activities ?? []).filter((a) => a.kind === 'task' && !a.done_at).length} open tasks), ${n(saved.proposals)} proposal,`,
    `${n(saved.personas)} personas, ${n(saved.email_templates)} templates, ${n(saved.forms)} forms (${n(saved.form_submissions)} submissions),`,
    `${n(saved.surveys)} survey (${n(saved.survey_responses)} responses), ${n(saved.notifications)} notifications,`,
    `${n(saved.contact_fields)} custom fields, ${stopsWritten ? n(demo.emailStops) : 0} email stops, sender ${demo.sender.email} (#${senderId}).`,
  ].join('\n'),
)
if (due.length) fail(`Something in the seeded data could send:\n${due.join('\n')}`)
