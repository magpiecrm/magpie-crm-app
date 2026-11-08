// A first go at answering someone who replied to a sequence ("Draft reply
// with AI" in the inbox and a sequence's Replies): written by the AI from the
// whole conversation, who they are, the deal if there is one, and what the
// sequence offers (its brief, or its first email), in the sender's voice. It
// goes into the answer box to be read and changed, and is never sent by
// itself. Words already typed in the box steer it ("say yes, offer Tuesday").
//
// It ends with the sign-off an AI's email has (render.ts aiSignOff), less
// what sendReply puts under every answer anyway: the sequence's own sign-off.

import { z } from 'zod'
import { db } from '../db'
import { AiFailed, generate, type GenerateOptions } from '../copilot/generate'
import { mergeContact } from '../mergeTags'
import { splitQuoted } from '../../features/sequences/quote'
import type { ResearchFact } from '../../features/sequences/types'
import { conversations } from './conversation'
import { aiSignOff, stripSignOff } from './render'

/** Earlier emails in the conversation the AI reads, the latest kept. */
const MAX_ITEMS = 12
/** Each email's words, at most. */
const ITEM_MAX = 3_000
export const NOTES_MAX = 2_000

const SYSTEM = `You draft a salesperson's answer to someone who replied to their cold email. You're given what's being offered (a brief, or the first email that went out), the conversation so far (oldest first), who they are, and the deal if there is one. The salesperson reads and edits your draft before sending it.

Write the answer to their latest message:
- Answer what they actually said or asked, first. If they're interested, move it on with one clear next step: a short call, or sending what they asked for. If they said no or not now, thank them in a line and leave the door open, without pushing. If they asked not to be emailed, say you won't again.
- Only say what the brief, the emails or the salesperson's notes say. Never make up prices, dates, times, links, features or customers: where one's needed and you don't have it, ask them, or say you'll send it.
- Plain text, 30 to 120 words, like one person to another; their first name if you greet them. No subject line, no placeholders or [brackets], no merge tags.
- No sign-off or signature: it's added after your text.
- When the salesperson gives notes, follow them: they say what the answer should be.
- Answer by calling the writeReply tool.`

const ANSWER = {
  name: 'writeReply',
  description: 'Your answer: the draft reply.',
  input: { body: z.string().describe('The reply itself, plain text, without a sign-off.') },
} satisfies GenerateOptions<any>['answer']

/** A placeholder or merge tag left in. */
const PLACEHOLDER = /\{\{|\}\}|\[[^\]\n]{1,40}\]|<(?:your|their|company|name|first|link|date|time)[^>\n]{0,30}>/i

export function replyPrompt(input: {
  from: { name?: string | null; company?: string; website?: string; tone?: string }
  offer: { brief: string | null; firstEmail: string | null }
  them: { name: string | null; title: string | null; company: string | null }
  deal: { name: string; stage: string; status: string } | null
  facts: ResearchFact[]
  thread: Array<{ who: 'you' | 'them'; from: string; at: string; text: string }>
  notes?: string
  problem?: string
}): string {
  const { from, offer, them, deal } = input
  return [
    `## From\n${[from.name ? `Name: ${from.name}` : null, from.company ? `Company: ${from.company}` : null, from.website ? `Website: ${from.website}` : null, from.tone ? `Tone of voice: ${from.tone}` : null].filter(Boolean).join('\n') || '(not given)'}`,
    offer.brief ? `## What's offered (the brief)\n${offer.brief}` : null,
    offer.firstEmail ? `## The first email that went out\n${offer.firstEmail}` : null,
    `## Them\n${[`Name: ${them.name ?? '(not known)'}`, them.title ? `Job: ${them.title}` : null, them.company ? `Company: ${them.company}` : null].filter(Boolean).join('\n')}`,
    deal ? `## The deal\n${deal.name}: ${deal.status === 'open' ? `at "${deal.stage}"` : deal.status}` : null,
    input.facts.length ? `## Facts about their company\n${input.facts.map((f, i) => `${i + 1}. ${f.text}`).join('\n')}` : null,
    `## The conversation (oldest first)\n${input.thread.map((m) => `### ${m.who === 'you' ? 'You' : m.from}, ${m.at.slice(0, 16).replace('T', ' ')}\n${m.text}`).join('\n\n')}`,
    input.notes?.trim() ? `## The salesperson's notes for this answer\n${input.notes.trim()}` : null,
    input.problem ? `## Fix this\nYour last draft had ${input.problem} in it. Write the words themselves, or ask them.` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Drafts an answer to the latest message in a conversation. `notes` are what
 * the salesperson typed first. Throws AiUnavailable or AiFailed, and the
 * conversation's own errors (nothing to answer, can't be answered).
 */
export async function draftReply(enrollmentId: string, notes = '', deps: { generate?: typeof generate } = {}): Promise<{ text: string }> {
  const view = conversations.get(enrollmentId)
  if (view.cannot_reply) throw new Error(view.cannot_reply)
  if (!view.items.some((i) => i.direction === 'in')) throw new Error('There is nothing of theirs to answer yet.')
  const s = db.data.sequences?.find((x) => x.id === view.sequence_id)!
  const e = db.data.sequence_enrollments?.find((x) => x.id === enrollmentId)!
  const contact = db.getContact(view.contact_email) ?? { email: view.contact_email }
  const brand = db.getBrandKit()
  const first = s.steps[0]

  const thread = view.items
    .filter((i) => i.text.trim())
    .slice(-MAX_ITEMS)
    .map((i) => ({
      who: i.direction === 'out' ? ('you' as const) : ('them' as const),
      from: i.from,
      at: i.at,
      // Their words without the earlier emails they quote, which are in the thread already.
      text: (i.direction === 'in' ? splitQuoted(i.text).body : i.text).slice(0, ITEM_MAX),
    }))
  const facts = Object.values(e.drafts ?? {}).flatMap((d) => d.facts ?? [])
  const seen = new Set<string>()
  const input = {
    from: { name: view.sender?.name, company: brand?.name, website: brand?.websiteUrl, tone: brand?.toneOfVoice },
    offer: {
      brief: first?.personalise?.brief?.trim() || null,
      firstEmail: first?.body.trim() ? mergeContact(first.body, contact as any, { html: false }) : null,
    },
    them: { name: view.name, title: view.title, company: view.company },
    deal: view.deal ? { name: view.deal.name, stage: view.deal.stage, status: view.deal.status } : null,
    facts: facts.filter((f) => !seen.has(f.text) && seen.add(f.text)).slice(0, 8),
    thread,
    notes: notes.slice(0, NOTES_MAX),
  }

  let body = ''
  let problem: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const { answer } = await (deps.generate ?? generate)({ system: SYSTEM, prompt: replyPrompt({ ...input, problem }), answer: ANSWER })
    body = stripSignOff(answer.body.trim(), view.sender?.name)
    problem = body.match(PLACEHOLDER)?.[0]
    if (!problem) break
  }
  if (!body) throw new AiFailed("The AI didn't write anything. Try again.")

  // The closing it ends with, less the sequence's sign-off that goes under every answer.
  const signature = s.settings.signature.trim()
  const full = aiSignOff(signature, view.sender?.name)
  const closing = signature && full.endsWith(signature) ? full.slice(0, -signature.length).trim() : full
  return { text: [body, closing].filter(Boolean).join('\n\n') }
}
