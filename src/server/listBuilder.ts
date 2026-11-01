// Lists built from filters over the workspace's own contacts. Filters fill a
// normal list once and are kept on it (`lists.built_from`), and new matches are
// added only when someone asks. Nothing here touches sending: everyone matching
// goes on the list, and a send leaves out who it always does.
//
// Previews run the same selection as the write, so what's promised is what's
// done. They return counts only: who matched stays on the server.

import { db, type DbSchema } from './db'
import { blanksIn, listFilterFields, selectForList, contactForPage, type Activity, type ContactFilter, type FilterableContact, type SavedFilter } from '../features/contacts/contactFilters'
import { optedOutAt } from './prospecting/suppression'
import { classifySeniority } from './prospecting/seniority'
import { bucketOf } from './prospecting/types'
import { syncCompanies } from './sales/companies'
import { whyNotEmailable } from './sequences'

export interface ListPreview {
  /** Everyone the filters pick. */
  matched: number
  /** Of those, already on the list. */
  alreadyOn: number
  /** Of those, taken off by hand, so left off. */
  removedByHand: number
  toAdd: number
  /** Of `toAdd`, who a send wouldn't leave out for good. Batches, daily limits and held guesses can still reduce a send. */
  canEmail: number
  wontEmail: { unsubscribed: number; bounced: number; opted_out: number }
  /** The filters pick every contact. */
  everyone: boolean
  blanks: Array<{ label: string; count: number; included: boolean }>
}

type Engagement = Record<'opened' | 'clicked' | 'replied', Activity>

const later = (a: string | null, b: string | null | undefined) => (b && (!a || b > a) ? b : a)

/**
 * Each person's opens, clicks and replies, and the latest email each could have
 * happened on. Reads only the times already judged to be people's (db.ts
 * judgeOpens, judgeClicks), so scanners stay out. Sequence emails are rows here
 * too, under a hidden campaign, with their own settings for what's tracked.
 */
function engagementByEmail(data: DbSchema): Map<string, Engagement> {
  const campaigns = new Map(data.campaigns.map((c) => [c.id, c]))
  const sequences = new Map((data.sequences ?? []).map((s) => [s.id, s]))
  const watched = new Set((data.mailboxes ?? []).filter((m) => m.status === 'ok').map((m) => m.sender_id))
  const people = new Map<string, Engagement>()
  const of = (email: string) => {
    const known = people.get(email)
    if (known) return known
    const blank = (): Activity => ({ last: null, eligible: null })
    const fresh = { opened: blank(), clicked: blank(), replied: blank() }
    people.set(email, fresh)
    return fresh
  }

  for (const r of data.campaign_recipients) {
    const person = of(r.contact_email)
    const campaign = campaigns.get(r.campaign_id)
    const sequence = campaign?.sequence_id ? sequences.get(campaign.sequence_id) : undefined
    person.opened.last = later(later(person.opened.last, r.last_opened_at ?? r.opened_at), r.clicked_at)
    person.clicked.last = later(person.clicked.last, r.clicked_at)
    person.replied.last = later(person.replied.last, r.replied_at)

    const sent = r.status.startsWith('bounced') ? null : (r.sent_at ?? campaign?.sent_at)
    const tracksOpens = sequence ? sequence.settings.track_opens : campaign?.track_opens !== false
    const tracksClicks = sequence ? sequence.settings.track_clicks : true
    if (tracksOpens) person.opened.eligible = later(person.opened.eligible, sent)
    if (tracksClicks) person.clicked.eligible = later(person.clicked.eligible, sent)
    if (sequence?.sender_id != null && watched.has(sequence.sender_id)) person.replied.eligible = later(person.replied.eligible, sent)
  }
  // A reply marked by hand is on the enrollment alone.
  for (const e of data.sequence_enrollments ?? []) of(e.contact_email).replied.last = later(of(e.contact_email).replied.last, e.replied_at)
  return people
}

/** Every contact with what filters can look at, in one pass over companies and sends. */
function filterableContacts(data: DbSchema): FilterableContact[] {
  const companies = new Map((data.companies ?? []).map((c) => [c.id, c]))
  const prospects = new Map((data.prospect_companies ?? []).filter((p) => p.domain).map((p) => [p.domain!.toLowerCase(), p]))
  const engagement = engagementByEmail(data)
  return data.contacts.map((c) => {
    const company = c.company_id ? companies.get(c.company_id) : undefined
    const staff = company?.headcount ?? prospects.get(company?.domain?.toLowerCase() ?? '')?.headcount
    return {
      ...contactForPage(c),
      seniority: classifySeniority(c.job_title ?? '') ?? undefined,
      companySize: bucketOf(staff) ?? undefined,
      industry: company?.industry ?? undefined,
      ...engagement.get(c.email),
    }
  })
}

function fieldsFor(data: DbSchema, contacts: FilterableContact[]) {
  return listFilterFields(data.contact_fields ?? [], contacts)
}

/** What can be filtered on, for the builder: not the functions, and no contact. */
export function listFieldInfo() {
  if (syncCompanies(db.data)) db.mutate(() => {})
  return fieldsFor(db.data, filterableContacts(db.data)).map(({ key, label, kind, options, hint }) => ({ key, label, kind, options, hint }))
}

/** Who these filters pick, what adding them would do, and which addresses to add. */
function evaluate(data: DbSchema, filters: ContactFilter[], on: Set<string>, removed: Set<string>) {
  const contacts = filterableContacts(data)
  const fields = fieldsFor(data, contacts)
  const matched = selectForList(contacts, filters, fields)
  const fresh = matched.filter((c) => !on.has(c.email) && !removed.has(c.email))
  const records = new Map(data.contacts.map((c) => [c.email, c]))
  const toAdd = fresh.map((c) => records.get(c.email)!)
  const optedOut = optedOutAt(db, toAdd)
  const wontEmail = { unsubscribed: 0, bounced: 0, opted_out: 0 }
  for (const contact of toAdd) {
    const reason = whyNotEmailable(contact, optedOut)
    if (reason) wontEmail[reason]++
  }
  const preview: ListPreview = {
    matched: matched.length,
    alreadyOn: matched.filter((c) => on.has(c.email)).length,
    removedByHand: matched.filter((c) => removed.has(c.email) && !on.has(c.email)).length,
    toAdd: toAdd.length,
    canEmail: toAdd.length - wontEmail.unsubscribed - wontEmail.bounced - wontEmail.opted_out,
    wontEmail,
    everyone: contacts.length > 0 && matched.length === contacts.length,
    blanks: blanksIn(contacts, matched, filters, fields),
  }
  const labelled: SavedFilter[] = filters.map((f) => ({ ...f, label: fields.find((x) => x.key === f.field)!.label }))
  return { preview, emails: toAdd.map((c) => c.email), labelled }
}

/** What a list from these filters would hold. Refuses filters it can't apply, as building would. */
export function previewList(filters: ContactFilter[]): ListPreview {
  if (syncCompanies(db.data)) db.mutate(() => {})
  return evaluate(db.data, filters, new Set(), new Set()).preview
}

/** Makes a list of everyone these filters pick, and keeps the filters on it. All in one save. */
export function buildList(input: { name: string; filters: ContactFilter[] }): ListPreview & { id: number; name: string } {
  const name = input.name.trim()
  if (!name) throw new Error('Give the list a name.')
  return db.mutate((data) => {
    syncCompanies(data)
    const { preview, emails, labelled } = evaluate(data, input.filters, new Set(), new Set())
    if (emails.length === 0) throw new Error('No contacts match these filters.')
    const id = data.lists.length ? Math.max(...data.lists.map((l) => l.id)) + 1 : 1
    data.lists.push({ id, name, created_at: new Date().toISOString(), built_from: { filters: labelled, refreshed_at: null, removed: [] } })
    for (const email of emails) data.list_contacts.push({ list_id: id, contact_email: email })
    return { ...preview, id, name }
  })
}

function builtList(data: DbSchema, listId: number) {
  const list = data.lists.find((l) => l.id === listId)
  if (!list) throw new Error("That list doesn't exist.")
  if (!list.built_from) throw new Error("That list wasn't built from filters.")
  return { list, built: list.built_from }
}

const onList = (data: DbSchema, listId: number) => new Set(data.list_contacts.filter((lc) => Number(lc.list_id) === listId).map((lc) => lc.contact_email))

/**
 * Who a list's saved filters would add now: the saved filters whole, or an
 * error. Dropping one whose field has gone would pick more people than it did.
 */
export function previewNewMatches(listId: number): ListPreview {
  if (syncCompanies(db.data)) db.mutate(() => {})
  const { built } = builtList(db.data, listId)
  return evaluate(db.data, built.filters, onList(db.data, listId), new Set(built.removed)).preview
}

/** Adds who now matches a list's saved filters. Nobody comes off, and nobody taken off by hand goes back. */
export function addNewMatches(listId: number): ListPreview {
  return db.mutate((data) => {
    syncCompanies(data)
    const { built } = builtList(data, listId)
    const { preview, emails } = evaluate(data, built.filters, onList(data, listId), new Set(built.removed))
    for (const email of emails) data.list_contacts.push({ list_id: listId, contact_email: email })
    built.refreshed_at = new Date().toISOString()
    return preview
  })
}
