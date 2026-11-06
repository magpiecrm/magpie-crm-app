// One sequence email as a contact would get it, for the editor's Preview and
// the copilot: merge tags filled in from a chosen contact (or someone
// enrolled, or a sample), the sign-off and unsubscribe line added, and the
// merge tags that would come out empty for them. Where the first email is
// written for each person, it's their own (or one written now, for "Try it
// on…", which isn't kept).

import { db } from '../db'
import { emptyMergeTags } from '../mergeTags'
import { sequences } from '.'
import { renderStep } from './render'
import { writeDraft } from './personalise'
import type { PersonalDraft, SequenceStep } from '../../features/sequences/types'

const SAMPLE = { email: 'ava@example.com', first_name: 'Ava', last_name: 'Stone', company: 'Larkspur' }

export function previewStep(sequenceId: string, stepIndex: number, subject: string | null, body: string, contactEmail?: string) {
  const { sequence } = sequences.get(sequenceId)
  const enrolled = db.data.sequence_enrollments?.find((e) => e.sequence_id === sequenceId)
  const contact = (contactEmail ? db.getContact(contactEmail) : null) ?? (enrolled ? db.getContact(enrolled.contact_email) : null) ?? SAMPLE
  // A follow-up without its own subject replies to the thread: "Re: <the last subject before it>".
  const own = subject?.trim()
  const thread = sequence.steps.slice(0, stepIndex).reverse().find((s) => s.subject?.trim())?.subject ?? ''
  const shownSubject = own || (stepIndex > 0 ? `Re: ${thread}` : '')
  // Their own first email, once it's written.
  const mine = stepIndex === 0 ? db.data.sequence_enrollments?.find((e) => e.sequence_id === sequenceId && e.contact_email === contact.email)?.personal : undefined
  const theirs = mine?.status === 'ready' && mine.subject && mine.body ? { subject: mine.subject, body: mine.body } : null
  const r = renderStep({ subject: theirs?.subject ?? shownSubject, body: theirs?.body ?? body, contact: contact as any, settings: sequence.settings, unsubscribeUrl: 'https://…/unsubscribe' })
  const personal: Pick<PersonalDraft, 'status' | 'reason' | 'facts'> | null = mine ? { status: mine.status, reason: mine.reason, facts: mine.facts } : null
  return { subject: r.subject, text: r.text, contact: contact.email, empty: theirs ? [] : emptyMergeTags(`${shownSubject}\n${body}`, contact as any), personal }
}

/**
 * A first email written now for one contact, from the step as it's being
 * edited (saved or not), for "Try it on…": researched and written as it
 * would be for real, but not kept (the company's research is).
 */
export async function previewPersonal(sequenceId: string, step: Pick<SequenceStep, 'subject' | 'body' | 'personalise'>, contactEmail: string) {
  const { sequence } = sequences.get(sequenceId)
  const contact = db.getContact(contactEmail)
  if (!contact) throw new Error('There is no contact with that address.')
  const first = { ...sequence.steps[0], ...step, personalise: { brief: step.personalise?.brief ?? '' } } as SequenceStep
  const out = await writeDraft({ steps: [first], sender_id: sequence.sender_id }, contact)
  const r = renderStep({
    subject: out.status === 'ready' ? out.subject : (first.subject ?? ''),
    body: out.status === 'ready' ? out.body : first.body,
    contact,
    settings: sequence.settings,
    unsubscribeUrl: 'https://…/unsubscribe',
  })
  return { contact: contact.email, status: out.status, subject: r.subject, text: r.text, facts: out.status === 'ready' ? out.facts : [], reason: out.status === 'fallback' ? out.reason : null }
}
