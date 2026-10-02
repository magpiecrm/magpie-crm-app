import { z } from 'zod'
import { defineTool } from '../types'

/**
 * Sequences (server/sequences/): a first email and follow-ups to each person
 * enrolled, days apart, stopping when they reply. Drafting one is free;
 * starting it and enrolling people are what send email, so those ask first.
 */

/** A sequence id, or its name matched the way a person would say it. */
async function resolveSequenceId(ref: string): Promise<string> {
  const { sequences } = await import('../../sequences')
  const all = sequences.list()
  if (all.some((s) => s.id === ref)) return ref
  const q = ref.trim().toLowerCase()
  const exact = all.filter((s) => s.name.toLowerCase() === q)
  const hits = exact.length ? exact : all.filter((s) => s.name.toLowerCase().includes(q))
  if (hits.length === 1) return hits[0].id
  if (hits.length > 1) throw new Error(`More than one sequence matches "${ref}": ${hits.map((s) => `"${s.name}" (${s.id})`).join(', ')}. Use the id.`)
  throw new Error(`No sequence matches "${ref}". Call getSequences for real ids.`)
}

/** A sender by id or email address. */
async function resolveSender(ref: number | string): Promise<number> {
  const { db } = await import('../../db')
  const found = typeof ref === 'number' ? db.data.senders.find((s) => s.id === ref) : db.data.senders.find((s) => s.email.toLowerCase() === String(ref).trim().toLowerCase())
  if (!found) throw new Error(`No sender ${JSON.stringify(ref)}. Call getSenders for the addresses you can send from.`)
  return found.id
}

const sequenceRef = z.string().describe('A sequence id from getSequences, or its name.')
const senderRef = z.union([z.number().int(), z.string()]).describe('A sender id or email address from getSenders.')

const stepInput = z.object({
  waitDays: z.number().int().min(0).max(90).describe('Days after the previous email with no reply (after enrolling, for the first; usually 0).'),
  subject: z
    .string()
    .max(200)
    .nullable()
    .describe('The subject. null for a follow-up that replies in the same thread ("Re: <first subject>"), which is usual. The first email needs one.'),
  body: z.string().min(1).max(10_000).describe('Plain text, short and personal. Merge tags: {{ contact.first_name | default: "there" }}, {{ contact.COMPANY }}, {{ contact.custom.<key> }}. No sign-off or unsubscribe line: the sequence adds them.'),
})

const settingsInput = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).describe('Days it sends on, 0 = Sunday … 6 = Saturday. Default Mon–Fri.'),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    timeZone: z.string().describe('IANA, e.g. Europe/London. Default: the user’s.'),
    dailyCap: z.number().int().min(1).max(500).describe('Most emails a day. 20–50 for cold email; less on a new domain.'),
    signature: z.string().max(2000).describe('Sign-off below every email: name, role, company.'),
    footer: z.string().max(1000).describe('Last line; must include {{ unsubscribe }}.'),
    trackOpens: z.boolean().describe('Off by default: needs consent (PECR) and hurts cold email deliverability.'),
    trackClicks: z.boolean(),
  })
  .partial()

const toSettings = (s: z.infer<typeof settingsInput>) => ({
  ...(s.days ? { days: s.days } : {}),
  ...(s.startHour !== undefined ? { start_hour: s.startHour } : {}),
  ...(s.endHour !== undefined ? { end_hour: s.endHour } : {}),
  ...(s.timeZone ? { time_zone: s.timeZone } : {}),
  ...(s.dailyCap !== undefined ? { daily_cap: s.dailyCap } : {}),
  ...(s.signature !== undefined ? { signature: s.signature } : {}),
  ...(s.footer !== undefined ? { footer: s.footer } : {}),
  ...(s.trackOpens !== undefined ? { track_opens: s.trackOpens } : {}),
  ...(s.trackClicks !== undefined ? { track_clicks: s.trackClicks } : {}),
})

/** A sequence as tools return it: its emails, settings, numbers and anything stopping it from running. */
async function describe(id: string) {
  const { sequences } = await import('../../sequences')
  const { sequence: s, summary, notReady } = sequences.get(id)
  const stats = sequences.stepStats(id)
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    pausedReason: s.paused_reason,
    notReady,
    sender: summary.sender,
    emails: s.steps.map((st, i) => ({
      step: i + 1,
      waitDays: st.delay_days,
      subject: st.subject,
      body: st.body,
      sent: stats[i]?.sent ?? 0,
      replied: stats[i]?.replied ?? 0,
      waiting: stats[i]?.waiting ?? 0,
    })),
    settings: s.settings,
    people: { enrolled: summary.enrolled, inProgress: summary.active, replied: summary.replied, finished: summary.finished, bounced: summary.bounced, unsubscribed: summary.unsubscribed },
    emailsSent: summary.sent,
  }
}

export const sequenceTools = [
  defineTool({
    name: 'getSequences',
    description: 'List sequences (not archived): status, sender, how many emails, people enrolled, in progress, replied, bounced and emails sent.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { sequences } = await import('../../sequences')
      return sequences.list()
    },
  }),

  defineTool({
    name: 'getSequence',
    description: "Read one sequence: each email's wait, subject and text with how many it went to and replies, its settings, its people, and what's missing before it can start (notReady).",
    input: { id: sequenceRef },
    target: 'server',
    readOnly: true,
    handler: async ({ id }) => describe(await resolveSequenceId(id)),
  }),

  defineTool({
    name: 'createSequence',
    description:
      'Draft a sequence: a first email and follow-ups (usually 2–3, 3–4 days apart, replying in the same thread). It sends nothing until it has people (enrollInSequence) and is started (setSequenceStatus). Write emails that are short, specific to the person, with one question; follow-ups add a new reason to reply, never "just checking in".',
    input: {
      name: z.string().min(1).max(120),
      sender: senderRef.optional().describe('Who it sends from (a sender id or email). Default: the first sender.'),
      emails: z.array(stepInput).min(1).max(10).optional(),
      settings: settingsInput.optional(),
    },
    target: 'server',
    handler: async ({ name, sender, emails, settings }, ctx) => {
      const { sequences } = await import('../../sequences')
      const s = sequences.create({ name, senderId: sender !== undefined ? await resolveSender(sender) : undefined, timeZone: ctx.getClientState().timeZone }, null)
      if (emails || settings) {
        sequences.update(s.id, {
          ...(emails ? { steps: emails.map((e) => ({ delay_days: e.waitDays, subject: e.subject, body: e.body })) } : {}),
          ...(settings ? { settings: toSettings(settings) } : {}),
        })
      }
      return { ...(await describe(s.id)), openIn: `/sales/sequences/${s.id}` }
    },
  }),

  defineTool({
    name: 'updateSequence',
    description:
      'Change a sequence: its name, sender, settings, or its emails. `emails` replaces them all, in order: pass every email (as getSequence returned them, with `step` kept for ones that stay) so people carry on where they are.',
    input: {
      id: sequenceRef,
      name: z.string().min(1).max(120).optional(),
      sender: senderRef.optional(),
      emails: z.array(stepInput.extend({ step: z.number().int().min(1).max(10).optional().describe('The existing email this is (from getSequence), so people on it stay on it.') })).min(1).max(10).optional(),
      settings: settingsInput.optional(),
    },
    target: 'server',
    handler: async ({ id, name, sender, emails, settings }) => {
      const { sequences } = await import('../../sequences')
      const seqId = await resolveSequenceId(id)
      const current = sequences.get(seqId).sequence.steps
      sequences.update(seqId, {
        ...(name !== undefined ? { name } : {}),
        ...(sender !== undefined ? { senderId: await resolveSender(sender) } : {}),
        ...(settings ? { settings: toSettings(settings) } : {}),
        ...(emails ? { steps: emails.map((e) => ({ id: e.step ? current[e.step - 1]?.id : undefined, delay_days: e.waitDays, subject: e.subject, body: e.body })) } : {}),
      })
      return describe(seqId)
    },
  }),

  defineTool({
    name: 'setSequenceStatus',
    description: 'Start ("active"), pause or archive a sequence. Starting means it emails everyone enrolled, in its sending hours; it refuses while something is missing (getSequence notReady). Archiving stops everyone in it.',
    input: { id: sequenceRef, status: z.enum(['active', 'paused', 'archived']) },
    target: 'server',
    destructive: true,
    handler: async ({ id, status }) => {
      const { sequences } = await import('../../sequences')
      const seqId = await resolveSequenceId(id)
      sequences.setStatus(seqId, status)
      return describe(seqId)
    },
  }),

  defineTool({
    name: 'previewEnrollment',
    description: "How many of a list's contacts (or of these addresses) would be added to a sequence, and why any would be left out (unsubscribed, bounced, opted out, already in it, in another running sequence). Adds nobody.",
    input: {
      id: sequenceRef,
      listId: z.number().int().optional().describe('A list id from getLists.'),
      emails: z.array(z.string().email()).max(5000).optional(),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ id, listId, emails }) => {
      const { sequences } = await import('../../sequences')
      return sequences.enroll(await resolveSequenceId(id), await emailsFor(listId, emails), { dryRun: true }, null)
    },
  }),

  defineTool({
    name: 'enrollInSequence',
    description:
      "Add a list's contacts, or these addresses (who must be contacts), to a sequence. Once it's running, each gets its emails in the sending hours. Leaves out anyone unsubscribed, bounced, opted out or already in a running sequence, and says how many. Use previewEnrollment first to tell the user how many it would be.",
    input: {
      id: sequenceRef,
      listId: z.number().int().optional().describe('A list id from getLists.'),
      emails: z.array(z.string().email()).max(5000).optional(),
    },
    target: 'server',
    destructive: true,
    handler: async ({ id, listId, emails }) => {
      const { sequences } = await import('../../sequences')
      return sequences.enroll(await resolveSequenceId(id), await emailsFor(listId, emails), {}, null)
    },
  }),

  defineTool({
    name: 'getEnrollments',
    description: "Who's in a sequence: each person's status (active, paused, replied, finished, unsubscribed, bounced, stopped), how many emails they've had, and when the next goes.",
    input: {
      id: sequenceRef,
      status: z.enum(['active', 'paused', 'replied', 'finished', 'unsubscribed', 'bounced', 'stopped']).optional(),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ id, status }) => {
      const { sequences } = await import('../../sequences')
      const seqId = await resolveSequenceId(id)
      const steps = sequences.get(seqId).sequence.steps.length
      return sequences.enrollments(seqId, status).slice(0, 200).map((e) => ({
        email: e.contact_email,
        name: e.name,
        company: e.company,
        status: e.status,
        reason: e.stop_reason,
        emailsSent: `${e.sends.length} of ${steps}`,
        nextEmailAt: e.status === 'active' ? e.next_send_at : null,
        repliedAt: e.replied_at,
      }))
    },
  }),

  defineTool({
    name: 'updateEnrollments',
    description: 'Pause, resume or stop people in a sequence, or mark that they replied (which stops their emails), by email address.',
    input: {
      id: sequenceRef,
      emails: z.array(z.string().email()).min(1).max(5000),
      action: z.enum(['pause', 'resume', 'mark_replied', 'stop']),
    },
    target: 'server',
    handler: async ({ id, emails, action }) => {
      const { sequences } = await import('../../sequences')
      const seqId = await resolveSequenceId(id)
      const wanted = new Set(emails.map((e) => e.toLowerCase().trim()))
      const ids = sequences.enrollments(seqId).filter((e) => wanted.has(e.contact_email)).map((e) => e.id)
      if (!ids.length) throw new Error('None of those addresses are in this sequence.')
      return { ...sequences.act(ids, action), notInSequence: wanted.size - ids.length }
    },
  }),

  defineTool({
    name: 'previewSequenceEmail',
    description: 'One email of a sequence as a contact would get it: subject and full text, with their details filled in, the sign-off and unsubscribe line, and any merge tags that come out empty for them.',
    input: {
      id: sequenceRef,
      step: z.number().int().min(1).max(10).describe('Which email, from 1.'),
      contactEmail: z.string().email().optional().describe('Whose details to fill in. Default: someone enrolled, or a sample.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ id, step, contactEmail }) => {
      const { sequences } = await import('../../sequences')
      const { previewStep } = await import('../../sequences/preview')
      const seqId = await resolveSequenceId(id)
      const s = sequences.get(seqId).sequence
      const st = s.steps[step - 1]
      if (!st) throw new Error(`It has ${s.steps.length} emails.`)
      return previewStep(seqId, step - 1, st.subject, st.body, contactEmail)
    },
  }),
]

/** A list's contacts, or the given addresses. */
async function emailsFor(listId: number | undefined, emails: string[] | undefined): Promise<string[]> {
  if (listId !== undefined) {
    const { db } = await import('../../db')
    const found = db.data.list_contacts.filter((lc) => lc.list_id == listId).map((lc) => lc.contact_email)
    if (!found.length) throw new Error(`List ${listId} has nobody in it, or doesn't exist. Call getLists.`)
    return found
  }
  if (emails?.length) return emails
  throw new Error('Give a listId or emails.')
}
