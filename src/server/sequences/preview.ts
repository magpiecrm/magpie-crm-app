// One sequence email as a contact would get it, for the editor's Preview and
// the copilot: merge tags filled in from a chosen contact (or someone
// enrolled, or a sample), the sign-off and unsubscribe line added, and the
// merge tags that would come out empty for them.

import { db } from '../db'
import { emptyMergeTags } from '../mergeTags'
import { sequences } from '.'
import { renderStep } from './render'

const SAMPLE = { email: 'ava@example.com', first_name: 'Ava', last_name: 'Stone', company: 'Larkspur' }

export function previewStep(sequenceId: string, stepIndex: number, subject: string | null, body: string, contactEmail?: string) {
  const { sequence } = sequences.get(sequenceId)
  const enrolled = db.data.sequence_enrollments?.find((e) => e.sequence_id === sequenceId)
  const contact = (contactEmail ? db.getContact(contactEmail) : null) ?? (enrolled ? db.getContact(enrolled.contact_email) : null) ?? SAMPLE
  // A follow-up without its own subject replies to the thread: "Re: <the last subject before it>".
  const own = subject?.trim()
  const thread = sequence.steps.slice(0, stepIndex).reverse().find((s) => s.subject?.trim())?.subject ?? ''
  const shownSubject = own || (stepIndex > 0 ? `Re: ${thread}` : '')
  const r = renderStep({ subject: shownSubject, body, contact: contact as any, settings: sequence.settings, unsubscribeUrl: 'https://…/unsubscribe' })
  return { subject: r.subject, text: r.text, contact: contact.email, empty: emptyMergeTags(`${shownSubject}\n${body}`, contact as any) }
}
