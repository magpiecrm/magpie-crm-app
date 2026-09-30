import { z } from 'zod'
import { defineTool } from '../types'

/**
 * Deals (to find), tasks and proposals (server/sales/). A proposal's design
 * is edited with the builder tools: in the app when it's open in the builder,
 * and from outside AI apps with a proposalId (storedDesigns.ts).
 */

const email = z.string().trim().toLowerCase().email()

/** A deal id, or a deal's name matched the way a person would say it. */
async function resolveDealId(ref: string): Promise<string> {
  const { sales } = await import('../../sales')
  const deals = sales.listDeals()
  if (deals.some((d) => d.id === ref)) return ref
  const q = ref.trim().toLowerCase()
  const exact = deals.filter((d) => d.name.toLowerCase() === q)
  const partial = exact.length ? exact : deals.filter((d) => d.name.toLowerCase().includes(q) || (d.company_name ?? '').toLowerCase().includes(q))
  if (partial.length === 1) return partial[0].id
  if (partial.length > 1) {
    throw new Error(`More than one deal matches "${ref}": ${partial.slice(0, 10).map((d) => `"${d.name}" (${d.id})`).join(', ')}. Use the id.`)
  }
  throw new Error(`No deal matches "${ref}". Call getDeals for real ids.`)
}

const dealRef = z.string().describe('A deal id from getDeals, or the deal\'s name (e.g. "Larkspur pilot").')

/** A due time: an ISO date-time, or a number of days from today at 9:00 in the user's time zone. */
function dueFrom(args: { dueAt?: string | null; dueInDays?: number }, timeZone?: string): string | null | undefined {
  if (args.dueAt !== undefined) return args.dueAt
  if (args.dueInDays === undefined) return undefined
  const tz = timeZone || 'UTC'
  // Today's date where the user is, then 9:00 there, as an instant.
  const day = new Date(Date.now() + args.dueInDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz })
  const guess = new Date(`${day}T09:00:00Z`)
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: tz }))
  const utcShown = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(guess.getTime() - (shown.getTime() - utcShown.getTime())).toISOString()
}

function taskOut(t: { id: string; body: string; due_at?: string | null; done_at?: string | null; deal_name: string | null; company_name: string | null; contact_name: string | null; deal_id: string | null; contact_email: string | null }) {
  return {
    id: t.id,
    task: t.body,
    dueAt: t.due_at ?? null,
    done: Boolean(t.done_at),
    about: t.deal_name ?? t.company_name ?? t.contact_name,
    dealId: t.deal_id,
    contactEmail: t.contact_email,
  }
}

export const salesTools = [
  defineTool({
    name: 'getDeals',
    description:
      'Find deals: open ones by default, optionally searched by name, company or person. Returns id, name, stage, value, company and people. Use the id with getProposals, createProposal, addTask or getTasks.',
    input: {
      search: z.string().optional().describe('Words from the deal name, its company, or a person on it.'),
      status: z.enum(['open', 'won', 'lost', 'all']).optional().describe('Default "open".'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ search, status }) => {
      const { sales } = await import('../../sales')
      const { formatMoney } = await import('../../../features/sales/types')
      const deals = sales.listDeals({ q: search, status: status === 'all' ? undefined : (status ?? 'open') })
      return deals.slice(0, 50).map((d) => ({
        id: d.id,
        name: d.name,
        stage: d.stage_name,
        pipeline: d.pipeline_name,
        status: d.status,
        value: d.value ? formatMoney(d.value, d.currency) : null,
        company: d.company_name,
        people: d.contacts,
        expectedClose: d.expected_close,
      }))
    },
  }),

  defineTool({
    name: 'getTasks',
    description:
      "List follow-up tasks: open ones soonest due first, then those done in the last two weeks. Narrow them to a deal, a company or a contact. Includes the current time, to tell what's overdue.",
    input: {
      dealId: dealRef.optional(),
      companyId: z.string().optional(),
      contactEmail: email.optional(),
      includeDone: z.boolean().optional().describe('Also list tasks done in the last two weeks. Default false.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ dealId, companyId, contactEmail, includeDone }) => {
      const { sales } = await import('../../sales')
      const tasks = sales.listTasks({ dealId: dealId ? await resolveDealId(dealId) : undefined, companyId, contactEmail })
      return { now: new Date().toISOString(), tasks: tasks.filter((t) => includeDone || !t.done_at).map(taskOut) }
    },
  }),

  defineTool({
    name: 'addTask',
    description:
      'Add a follow-up task, optionally on a deal, a company or a contact, due at a time. The user is notified when it falls due. For "follow up in 3 days" use dueInDays: 3 (9:00 their time); give dueAt for an exact time.',
    input: {
      task: z.string().min(1).max(2000).describe('What needs doing, e.g. "Follow up with Ava about the pilot".'),
      dueAt: z.string().datetime({ offset: true }).nullable().optional().describe('ISO date-time with offset. null for no due date.'),
      dueInDays: z.number().int().min(0).max(365).optional().describe('Due this many days from today, at 9:00 in the user\'s time zone. 0 is today.'),
      dealId: dealRef.optional(),
      companyId: z.string().optional(),
      contactEmail: email.optional(),
    },
    target: 'server',
    handler: async ({ task, dueAt, dueInDays, dealId, companyId, contactEmail }, ctx) => {
      const { sales } = await import('../../sales')
      const due = dueFrom({ dueAt, dueInDays }, ctx.getClientState().timeZone)
      const t = sales.addTask(
        { body: task, dueAt: due ?? null, dealId: dealId ? await resolveDealId(dealId) : undefined, companyId, contactEmail },
        null,
      )
      return taskOut(t)
    },
  }),

  defineTool({
    name: 'updateTask',
    description: 'Tick a task off (done: true) or reopen it, reword it, or move its due time (which sets its reminder again).',
    input: {
      id: z.string().describe('Task id from getTasks.'),
      done: z.boolean().optional(),
      task: z.string().min(1).max(2000).optional(),
      dueAt: z.string().datetime({ offset: true }).nullable().optional().describe('ISO date-time with offset, or null for no due date.'),
      dueInDays: z.number().int().min(0).max(365).optional(),
    },
    target: 'server',
    handler: async ({ id, done, task, dueAt, dueInDays }, ctx) => {
      const { sales } = await import('../../sales')
      return taskOut(sales.updateTask(id, { done, body: task, dueAt: dueFrom({ dueAt, dueInDays }, ctx.getClientState().timeZone) }))
    },
  }),

  defineTool({
    name: 'deleteTask',
    description: 'Delete a task. To mark one finished, use updateTask with done: true instead.',
    input: { id: z.string() },
    target: 'server',
    destructive: true,
    handler: async ({ id }) => {
      const { sales } = await import('../../sales')
      sales.deleteTask(id)
      return { deleted: id }
    },
  }),

  defineTool({
    name: 'getProposals',
    description:
      "A deal's proposals: title, link, whether it's been sent, how often it's been opened (not counting the team's previews or link scanners), and whether it was accepted and by whom.",
    input: { dealId: dealRef },
    target: 'server',
    readOnly: true,
    handler: async ({ dealId }) => {
      const { sales } = await import('../../sales')
      const { getAppUrl } = await import('../../appUrl')
      return sales.listProposals(await resolveDealId(dealId), await getAppUrl()).map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url,
        sentAt: p.sent_at,
        opens: p.views,
        lastOpenedAt: p.last_viewed_at,
        acceptedAt: p.accepted_at,
        acceptedBy: p.accepted_by,
      }))
    },
  }),

  defineTool({
    name: 'createProposal',
    description:
      'Make a proposal for a deal: a page the client opens from a private link and can accept. "layout" (the default) starts from a proposal layout filled in from the deal: greeting, the situation, scope, a price table with the deal value, and next steps. "template" starts from a saved template (templateId from getSavedTemplates); "blank" is empty. Then write its content: in the app, tell the user to open it (Proposals on the deal page) and edit it in the builder with you; outside the app, use the builder tools with its proposalId. It is not sent until shareProposal or sendProposal.',
    input: {
      dealId: dealRef,
      title: z.string().min(1).max(200).describe('Shown at the top of the page and in the email, e.g. "Proposal for Larkspur".'),
      start: z.enum(['layout', 'template', 'blank']).optional(),
      templateId: z.string().optional(),
    },
    target: 'server',
    handler: async ({ dealId, title, start, templateId }) => {
      const { startProposal } = await import('../../proposalActions')
      const p = await startProposal({ dealId: await resolveDealId(dealId), title, start: start ?? 'layout', templateId }, null)
      return { id: p.id, title: p.title, dealId: p.deal_id, editIn: `/sales/proposals/${p.id}` }
    },
  }),

  defineTool({
    name: 'renameProposal',
    description: "Change a proposal's title.",
    input: { id: z.string().describe('Proposal id from getProposals.'), title: z.string().min(1).max(200) },
    target: 'server',
    handler: async ({ id, title }) => {
      const { sales } = await import('../../sales')
      const p = sales.updateProposal(id, { title })
      return { id: p.id, title: p.title }
    },
  }),

  defineTool({
    name: 'shareProposal',
    description:
      "Get a proposal's link for the user to send themselves. The first time, it's marked sent and the deal moves to the pipeline's \"Proposal sent\" stage if it's before it. To email it from the app, use sendProposal.",
    input: { id: z.string().describe('Proposal id from getProposals.') },
    target: 'server',
    handler: async ({ id }) => {
      const { shareProposal } = await import('../../proposalActions')
      return shareProposal(id, null)
    },
  }),

  defineTool({
    name: 'sendProposal',
    description:
      "Email a proposal's link to people, from the default sender: your message, then a button to open it. Skips anyone unsubscribed or bounced. Marks it sent and moves the deal to \"Proposal sent\" if it's before it. Write the message as the user would, in plain text; the link is added for you.",
    input: {
      id: z.string().describe('Proposal id from getProposals.'),
      to: z.array(email).min(1).max(10).describe("Usually the deal's people (getDeals)."),
      subject: z.string().min(1).max(300),
      message: z.string().min(1).max(10_000).describe('Plain text; blank lines between paragraphs.'),
    },
    target: 'server',
    destructive: true,
    handler: async (args) => {
      const { sendProposal } = await import('../../proposalActions')
      return sendProposal(args, null)
    },
  }),

  defineTool({
    name: 'deleteProposal',
    description: 'Delete a proposal. Its link stops working.',
    input: { id: z.string() },
    target: 'server',
    destructive: true,
    handler: async ({ id }) => {
      const { sales } = await import('../../sales')
      sales.deleteProposal(id)
      return { deleted: id }
    },
  }),
]
