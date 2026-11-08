// Personalised emails (SequenceStep.personalise on the first step): for each
// person enrolled, the AI writes their own version of every email in the
// sequence, from the brief, what it finds about their company
// (companyResearch.ts) and their name, job and company. A follow-up is
// written from what they've already been sent, with a new reason to reply.
// Each step's own subject and body are the example it follows, and what's
// sent when it can't write one. A follow-up can be left without one: the AI
// writes it from the brief and what came before, and if it can't, that
// follow-up isn't sent and they go on to the next (engine.ts).
//
// Each email is written a little ahead of its send (runDrafts, from the
// email scheduler, a few a minute), once the one before it has gone, and the
// engine holds it until it's there. They send without review, so each is
// checked first (checkDraft): no merge tags or placeholders left in, no links
// that weren't in the brief or the examples, not opening by describing their
// own company, no "just checking in", a sensible length. The sign-off and
// the unsubscribe line are added at sending, as for every sequence email, and
// an email the AI wrote always signs off (render.ts aiSignOff).
//
// Where the AI can't be used at all (no key, no AI budget) the sequence
// pauses rather than sending everyone the standard emails, and carries on by
// itself once it can. Only the company is researched: what's known about the
// person is what's already on the contact.

import { z } from 'zod'
import { db, type DbSchema } from '../db'
import { isPersonalised, pendingDraft, SUBJECT_MAX, type Enrollment, type ResearchFact, type Sequence, type SequenceStep } from '../../features/sequences/types'
import { AiUnavailable, aiAvailable, generate, type GenerateOptions } from '../copilot/generate'
import { researchCompany, type ResearchCompany } from '../prospecting/companyResearch'
import { companyKey } from '../prospecting/socialfetch'
import { workDomain } from '../sales/companies'
import { mergeContact } from '../mergeTags'
import { notify } from '../notify'
import { recordUsage } from '../usage'
import { stripSignOff } from './render'

type Contact = DbSchema['contacts'][number]

/** Drafts written per run (a minute): a research call can take a few of the host's AI calls, and its share is 30 a minute, the copilot's too. */
const PER_RUN = 6
/** How far ahead of its send a draft is written. */
const AHEAD_MS = 24 * 60 * 60_000
/** Failed tries before the step's own email goes instead. */
const MAX_ATTEMPTS = 3
/** Telling someone the AI is out again, at most this often per sequence. */
const NOTICE_EVERY_MS = 24 * 60 * 60_000
/** A sequence paused for the AI waits this long before trying again, so a refused key doesn't pause and resume it every minute. */
export const AI_RETRY_MS = 60 * 60_000

export const BODY_MAX = 2_000

/** The company the research is about, from the contact: its name, the website from their work address, and their country. */
export function companyOf(contact: Pick<Contact, 'email' | 'company' | 'country'>): ResearchCompany | null {
  const name = contact.company?.trim() || null
  const domain = workDomain(contact.email) ?? (name ? (db.getCompanySite(companyKey(name))?.domain ?? null) : null)
  if (!name && !domain) return null
  return { name: name ?? domain!, domain, country: contact.country ?? null }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi
const normUrl = (u: string) => u.replace(/[.,;:!?]+$/, '').replace(/\/+$/, '').toLowerCase()

/** The links an email may hold: those in the brief, the example email, and the brand kit's website. */
export function allowedLinks(step: Pick<SequenceStep, 'subject' | 'body' | 'personalise'>, websiteUrl?: string | null): Set<string> {
  const text = [step.personalise?.brief ?? '', step.subject ?? '', step.body, websiteUrl ?? ''].join('\n')
  return new Set([...text.matchAll(URL_RE)].map((m) => normUrl(m[0])))
}

/** What's wrong with a draft, in words for the AI's second try (and the People tab), or null when it can be sent. */
/**
 * The email opens by telling them what their own company does ("Acme is a…",
 * "Acme's app…", "At Acme, you…"), rather than what that means for them.
 */
export function restatesCompany(body: string, company: string | null | undefined): boolean {
  const name = company?.trim().replace(/[,.]?\s+(ltd|limited|llc|inc|plc|gmbh)\.?$/i, '')
  if (!name) return false
  // The first sentence after the greeting.
  const first = body.trim().replace(/^(hi|hello|hey|dear)\b[^\n]*\n+/i, '').split(/(?<=[.!?])\s/)[0] ?? ''
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const verbs = '(is|are|was|makes|builds|helps|provides|offers|runs|sells|lets|gives|has|does|handles|serves|works)'
  // "Acme's two new sites mean…" is about them, and passes; "Acme's app handles…" describes it back.
  return new RegExp(`^(${n}('s|’s)?\\s+(\\w+\\s+){0,3}${verbs}\\b|at\\s+${n},?\\s+(you|your team)\\b)`, 'i').test(first.trim())
}

export function checkDraft(
  draft: { subject: string; body: string },
  allowed: Set<string>,
  company?: string | null,
  opts: { needsSubject?: boolean; minBody?: number } = {},
): string | null {
  const subject = draft.subject.trim()
  const body = draft.body.trim()
  if (opts.needsSubject !== false) {
    if (!subject) return 'The subject is empty.'
    if (/[\r\n]/.test(subject)) return 'The subject has a line break in it.'
    if (subject.length > SUBJECT_MAX) return `The subject is over ${SUBJECT_MAX} characters.`
  }
  if (body.length < (opts.minBody ?? 80)) return 'The email is too short.'
  if (body.length > BODY_MAX) return `The email is over ${BODY_MAX} characters.`
  const text = `${subject}\n${body}`
  if (/\{\{|\}\}/.test(text)) return 'It has a merge tag ({{ … }}) in it; write the words themselves.'
  const placeholder = text.match(/\[[^\]\n]{1,40}\]|<(?:your|their|company|name|first)[^>\n]{0,30}>/i)
  if (placeholder) return `It has a placeholder left in it: ${placeholder[0]}`
  if (/unsubscribe/i.test(body)) return 'It mentions unsubscribing; that line is added to every email already.'
  const foreign = [...text.matchAll(URL_RE)].map((m) => m[0]).find((u) => !allowed.has(normUrl(u)))
  if (foreign) return `It links to ${foreign}, which wasn't in the brief or the example email.`
  if (restatesCompany(body, company)) return "It opens by telling them what their own company does. Open with what their situation means for them, and how the offer helps a business like theirs."
  return null
}

const SYSTEM = `You write the first cold email from a salesperson to one person, in the salesperson's voice. You're given a brief (what's being offered), an example email that shows the offer and style, the recipient's name, job and company, and a few facts about their company with their sources.

The email's job is to show how the offer would help their company in particular. They know what their own company does, so never tell them: don't describe their business, products or customers back to them. Use the facts to work out what their business is likely dealing with (the customers it serves, how it sells and delivers, its size or growth, what it has just launched) and explain the offer in those terms: what it would do for a business like theirs, and for someone in their job.

For example, writing for a payroll service to someone at a restaurant group that has just opened two sites:
- Not: "Larch Kitchens runs six restaurants across Leeds and has just opened two more."
- But: "Two new sites means two more rotas, and a lot more shift changes to get right in payroll each month."

Write like one person to another:
- Plain text, 50 to 140 words, short paragraphs. A subject line under 60 characters about what the offer would do for them, never clickbait.
- Open with what their situation means for them, in a sentence or two. Then how the offer fits it, tied to how their business works. Only claim what the brief says the offer does. End with one simple question.
- Use only the facts given. Never invent anything about them or their company, and don't say you looked them up or came across their website. If there are no facts, tailor it to their job and the kind of company theirs is.
- Follow the brief. Keep the example's offer, tone and any link it has; don't copy it word for word.
- No greeting placeholder, merge tags ({{ … }}) or [brackets]: write their first name itself. No sign-off or signature, and no unsubscribe line: both are added after your text.
- Answer by calling the writeEmail tool.`

const ANSWER = {
  name: 'writeEmail',
  description: 'Your answer: the email to send this person.',
  input: {
    subject: z.string().describe('The subject line.'),
    body: z.string().describe('The email itself, plain text, without a sign-off or unsubscribe line.'),
    facts_used: z.array(z.number().int()).describe('The numbers of the facts the email mentions.'),
  },
} satisfies GenerateOptions<any>['answer']

const FOLLOW_UP_SYSTEM = `You write a follow-up cold email from a salesperson to one person who hasn't replied yet, in the salesperson's voice. You're given the brief (what's being offered), the emails they've already been sent, an example of what this follow-up is for when there is one, the recipient's name, job and company, and a few facts about their company with their sources.

The follow-up's job is to give them one new reason to reply: a different angle on how the offer helps a business like theirs, drawn from a fact or a part of their situation the earlier emails didn't use. They know what their own company does, so never describe it back to them, and don't repeat or sum up what the earlier emails said.

Write like one person to another:
- Plain text, 30 to 90 words, one or two short paragraphs.
- Never "just checking in", "following up", "bumping this" or "circling back", and no apology for writing again. Open with the new point.
- Only claim what the brief says the offer does, and use only the facts given. Don't say you looked them up or came across their website.
- Where there's an example, keep its purpose and tone; don't copy it word for word. Without one, keep to the earlier emails' tone. End with one simple question, not one they've already been asked.
- No greeting placeholder, merge tags ({{ … }}) or [brackets]: write their first name itself if you greet them. No sign-off or signature, and no unsubscribe line: both are added after your text.
- Answer by calling the writeFollowUp tool.`

const FOLLOW_UP_ANSWER = {
  name: 'writeFollowUp',
  description: 'Your answer: the follow-up to send this person.',
  input: {
    subject: z.string().optional().describe('Only when you were asked for a subject line; otherwise leave it out, as it replies in the same conversation.'),
    body: z.string().describe('The follow-up itself, plain text, without a sign-off or unsubscribe line.'),
    facts_used: z.array(z.number().int()).describe('The numbers of the facts it mentions.'),
  },
} satisfies GenerateOptions<any>['answer']

/** An email they've already been sent, as they got it (without the sign-off and unsubscribe line). */
export interface SentEmail {
  label: string
  subject: string
  body: string
}

/** What they've been sent before step `stepIndex`: their own version where there was one, else the step's own email filled in for them. */
export function sentBefore(
  s: Pick<Sequence, 'steps'>,
  e: Pick<Enrollment, 'sends' | 'drafts'>,
  contact: Parameters<typeof mergeContact>[1],
  stepIndex: number,
): SentEmail[] {
  return s.steps.slice(0, stepIndex).flatMap((step, j) => {
    const send = e.sends.find((x) => x.step_id === step.id)
    if (!send) return []
    const own = e.drafts?.[step.id]
    const body = own?.status === 'ready' && own.body ? own.body : mergeContact(step.body, contact, { html: false })
    return [{ label: j === 0 ? 'First email' : `Follow-up ${j}`, subject: send.subject, body }]
  })
}

export function draftPrompt(input: {
  step: Pick<SequenceStep, 'subject' | 'body' | 'personalise'>
  /** The brief, for a follow-up (it's kept on the first step). */
  brief?: string
  contact: Pick<Contact, 'email' | 'first_name' | 'last_name' | 'job_title' | 'company' | 'country' | 'custom'>
  facts: ResearchFact[]
  sender: { name?: string | null } | null
  brand: { name?: string; websiteUrl?: string; toneOfVoice?: string } | null
  /** For a follow-up: what they've been sent, and whether it starts a new conversation with a subject of its own. */
  followUp?: { sent: SentEmail[]; ownSubject: boolean }
  problem?: string
}): string {
  const { step, contact, facts, sender, brand, followUp } = input
  const fill = (text: string) => mergeContact(text, contact, { html: false })
  const brief = (input.brief ?? step.personalise?.brief ?? '').trim()
  return [
    `## From`,
    [sender?.name ? `Name: ${sender.name}` : null, brand?.name ? `Company: ${brand.name}` : null, brand?.websiteUrl ? `Website: ${brand.websiteUrl}` : null, brand?.toneOfVoice ? `Tone of voice: ${brand.toneOfVoice}` : null]
      .filter(Boolean)
      .join('\n') || '(not given)',
    `## Brief\n${brief || '(none: follow the example)'}`,
    followUp
      ? `## What you've sent them so far (no reply yet)\n${followUp.sent.map((m) => `### ${m.label}\nSubject: ${m.subject}\n\n${m.body}`).join('\n\n') || '(nothing)'}`
      : null,
    followUp
      ? step.body.trim()
        ? `## What this follow-up is for (example)\n${followUp.ownSubject ? `Subject: ${fill(step.subject ?? '')}\n\n` : ''}${fill(step.body)}`
        : `## What this follow-up is for\n${followUp.ownSubject ? `A subject to start from: ${fill(step.subject ?? '')}\n\n` : ''}(no example: give them one new reason to reply, from the brief and the facts)`
      : `## Example email\nSubject: ${fill(step.subject ?? '')}\n\n${fill(step.body)}`,
    followUp ? (followUp.ownSubject ? 'This follow-up starts a new conversation: give it a subject line under 60 characters.' : 'It replies in the same conversation: no subject line.') : null,
    `## To\n${[`First name: ${contact.first_name?.trim() || '(not known: start with a plain "Hi")'}`, contact.job_title ? `Job: ${contact.job_title}` : null, contact.company ? `Company: ${contact.company}` : null, contact.country ? `Country: ${contact.country}` : null].filter(Boolean).join('\n')}`,
    `## Facts about their company (they know all this: use it to tailor the offer, don't repeat it)\n${facts.length ? facts.map((f, i) => `${i + 1}. ${f.text}${f.url ? ` (${f.url})` : ''}`).join('\n') : '(nothing found)'}`,
    input.problem ? `## Fix this\nYour last version couldn't be sent: ${input.problem} Write it again without that.` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** A follow-up that only says it's following up. */
const NUDGE = /\b(just (checking|following|circling) (in|up|back)|following up on my|bumping this|circling back|checking in again)\b/i

export type Written = { status: 'ready'; subject?: string; body: string; facts: ResearchFact[] } | { status: 'fallback'; reason: string }

/**
 * Researches their company and writes their own version of one email: the
 * first (`stepIndex` 0), or a follow-up, from what they've already been sent
 * (`enrollment`). Throws the AI's errors (AiUnavailable, AiFailed).
 */
export async function writeDraft(
  s: Pick<Sequence, 'steps' | 'sender_id'>,
  contact: Contact,
  deps: { generate?: typeof generate; research?: typeof researchCompany; save?: boolean } = {},
  at: { stepIndex: number; enrollment?: Pick<Enrollment, 'sends' | 'drafts'> } = { stepIndex: 0 },
): Promise<Written> {
  const first = s.steps[0]
  const step = s.steps[at.stepIndex]
  if (!first?.personalise || !step) return { status: 'fallback', reason: "This sequence's emails aren't written for each person." }
  const followUp = at.stepIndex > 0 ? { sent: at.enrollment ? sentBefore(s, at.enrollment, contact, at.stepIndex) : [], ownSubject: !!step.subject?.trim() } : undefined
  const company = companyOf(contact)
  const research = company ? await (deps.research ?? researchCompany)(company, { save: deps.save }) : { facts: [] as ResearchFact[] }
  const sender = db.data.senders.find((x) => x.id === s.sender_id) ?? null
  const brand = db.getBrandKit()
  // Links from the brief, this step and the first email's example may be used.
  const allowed = new Set([...allowedLinks(first, brand?.websiteUrl), ...allowedLinks(step)])
  let problem: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = draftPrompt({ step, brief: first.personalise.brief, contact, facts: research.facts, sender, brand, followUp, problem })
    const { answer } = followUp
      ? await (deps.generate ?? generate)({ system: FOLLOW_UP_SYSTEM, prompt, answer: FOLLOW_UP_ANSWER })
      : await (deps.generate ?? generate)({ system: SYSTEM, prompt, answer: ANSWER })
    const needsSubject = !followUp || followUp.ownSubject
    // A closing it added anyway comes off: the sign-off goes on at sending.
    const draft = { subject: needsSubject ? (answer.subject ?? '').trim() : '', body: stripSignOff(answer.body.trim(), sender?.name) }
    problem = checkDraft(draft, allowed, contact.company, { needsSubject, minBody: followUp ? 40 : 80 }) ?? undefined
    if (!problem && followUp && NUDGE.test(draft.body)) problem = 'It says it\'s following up or checking in; give the new reason to reply instead.'
    if (!problem) {
      const used = [...new Set(answer.facts_used)].map((n) => research.facts[n - 1]).filter((f): f is ResearchFact => !!f)
      return { status: 'ready', ...(draft.subject ? { subject: draft.subject } : {}), body: draft.body, facts: used }
    }
  }
  return { status: 'fallback', reason: `The AI's email couldn't be sent as written: ${problem}` }
}

const lastNotice = new Map<string, number>()

/** Pauses a sequence until the AI can be used again (engine.ts maybeResume), telling someone at most once a day. */
export function pauseForAi(s: Sequence, reason: string, now = new Date()) {
  db.mutate(() => {
    s.status = 'paused'
    s.paused_reason = `Its emails are written for each person by the AI, which can't be used right now: ${reason}`
    s.auto_paused = 'ai'
    s.updated_at = now.toISOString()
  })
  if (now.getTime() - (lastNotice.get(s.id) ?? 0) < NOTICE_EVERY_MS) return
  lastNotice.set(s.id, now.getTime())
  notify('sequence_paused', `"${s.name}" paused: ${s.paused_reason}`, { url: `/sales/sequences/${s.id}` })
}

/** A sequence paused for the AI may carry on: it can be used, and it's been long enough since it last failed. */
export function aiCleared(s: Pick<Sequence, 'updated_at'>, now = new Date()): boolean {
  return aiAvailable().ok && now.getTime() - Date.parse(s.updated_at) >= AI_RETRY_MS
}

/** The emails to write now: each person's next one in running sequences, due within a day and not yet written, soonest first. */
export function dueDrafts(data: DbSchema, now = new Date()): Array<{ s: Sequence; e: Enrollment; stepIndex: number }> {
  const running = new Map((data.sequences ?? []).filter((s) => s.status === 'active' && isPersonalised(s)).map((s) => [s.id, s]))
  if (!running.size) return []
  const until = now.getTime() + AHEAD_MS
  return (data.sequence_enrollments ?? [])
    .flatMap((e) => {
      const s = running.get(e.sequence_id)
      const step = s?.steps[e.next_step]
      if (!s || !step || e.status !== 'active' || e.claim || !e.next_send_at || Date.parse(e.next_send_at) > until) return []
      const d = e.drafts?.[step.id]
      return !d || d.status === 'pending' ? [{ s, e, stepIndex: e.next_step }] : []
    })
    .sort((a, b) => a.e.next_send_at!.localeCompare(b.e.next_send_at!))
}

const emailName = (stepIndex: number) => (stepIndex === 0 ? 'first email' : `follow-up ${stepIndex}`)

/** Writes the emails due soon, first emails and follow-ups (the email scheduler, every minute). Returns how many it wrote. */
export async function runDrafts(now = new Date(), deps: Parameters<typeof writeDraft>[2] = {}): Promise<number> {
  const due = dueDrafts(db.data, now)
  if (!due.length) return 0
  const ai = aiAvailable()
  if (!ai.ok) {
    for (const s of new Set(due.map((d) => d.s))) pauseForAi(s, ai.reason, now)
    return 0
  }
  let written = 0
  for (const { s, e, stepIndex } of due.slice(0, PER_RUN)) {
    if (s.status !== 'active') continue
    const contact = db.getContact(e.contact_email)
    // Gone or unsubscribed: the engine ends them.
    if (!contact) continue
    const stepId = s.steps[stepIndex].id
    const drafts = () => (e.drafts ??= {})
    if (!drafts()[stepId]) db.mutate(() => (drafts()[stepId] = pendingDraft(now)))
    const asked = drafts()[stepId].at
    // Edited or rewritten meanwhile (the step changed, or someone asked again): this one's out of date.
    const stale = () => drafts()[stepId]?.status !== 'pending' || drafts()[stepId].at !== asked
    try {
      const out = await writeDraft(s, contact, deps, { stepIndex, enrollment: e })
      if (stale()) continue
      db.mutate(() => {
        const at = new Date().toISOString()
        drafts()[stepId] =
          out.status === 'ready'
            ? { status: 'ready', ...(out.subject ? { subject: out.subject } : {}), body: out.body, facts: out.facts, at, attempts: 0 }
            : { status: 'fallback', reason: out.reason, at, attempts: 0 }
      })
      recordUsage(out.status === 'ready' ? { personalDrafts: 1 } : { personalFallbacks: 1 })
      written++
    } catch (err: any) {
      if (err instanceof AiUnavailable) {
        for (const x of new Set(due.map((d) => d.s))) pauseForAi(x, err.message, now)
        return written
      }
      // Busy, overloaded or a bad answer: tried again next run, then the step's own email.
      const attempts = (drafts()[stepId]?.attempts ?? 0) + 1
      console.error(`[Sequences] Couldn't write a ${emailName(stepIndex)} for "${s.name}" (try ${attempts}): ${err?.message ?? err}`)
      if (stale()) continue
      db.mutate(() => {
        drafts()[stepId] =
          attempts >= MAX_ATTEMPTS
            ? { status: 'fallback', reason: `The AI couldn't write it: ${err?.message ?? 'no answer'}`, at: new Date().toISOString(), attempts }
            : { status: 'pending', at: asked, attempts }
      })
      if (attempts >= MAX_ATTEMPTS) recordUsage({ personalFallbacks: 1 })
    }
  }
  return written
}
