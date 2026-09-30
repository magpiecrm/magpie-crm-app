// Tasks: follow-ups due at a time, on a deal, a company or a contact (or on
// nothing in particular). Kept as activities of kind 'task', so each shows in
// its record's timeline too, with when it's due, when it was done, and when
// its reminder went out (remindDueTasks, run by the email scheduler).

import { randomUUID } from 'node:crypto'
import type { DbSchema } from '../db'
import type { Activity } from '../../features/sales/types'

const normEmail = (e: string) => e.toLowerCase().trim()

export interface TaskInput {
  body: string
  /** ISO time; null for no due date. */
  dueAt: string | null
  dealId?: string
  companyId?: string
  contactEmail?: string
}

/** A task with what it's about, for the Tasks page. */
export interface TaskView extends Activity {
  deal_name: string | null
  company_name: string | null
  contact_name: string | null
  /** The page it's about, to open from the task or its reminder. */
  link: string
}

function checkDue(dueAt: string | null): string | null {
  if (dueAt === null) return null
  const t = Date.parse(dueAt)
  if (Number.isNaN(t)) throw new Error("That due date isn't a date.")
  return new Date(t).toISOString()
}

export function addTask(data: DbSchema, input: TaskInput, actor: string | null): Activity {
  const body = input.body.trim()
  if (!body) throw new Error('Say what needs doing.')
  const deal = input.dealId ? data.deals?.find((d) => d.id === input.dealId) : undefined
  if (input.dealId && !deal) throw new Error('Deal not found')
  if (input.companyId && !data.companies?.some((c) => c.id === input.companyId)) throw new Error('Company not found')
  const email = input.contactEmail ? normEmail(input.contactEmail) : null
  if (email && !data.contacts.some((c) => c.email === email)) throw new Error('Contact not found')
  const task: Activity = {
    id: randomUUID(),
    kind: 'task',
    deal_id: deal?.id ?? null,
    company_id: input.companyId ?? deal?.company_id ?? null,
    contact_email: email,
    body,
    due_at: checkDue(input.dueAt),
    done_at: null,
    reminded_at: null,
    created_by: actor,
    created_at: new Date().toISOString(),
  }
  ;(data.activities ??= []).push(task)
  return task
}

function taskById(data: DbSchema, id: string): Activity {
  const task = data.activities?.find((a) => a.id === id && a.kind === 'task')
  if (!task) throw new Error('Task not found')
  return task
}

/** Changes what a task says, when it's due (which re-arms its reminder), or whether it's done. */
export function updateTask(data: DbSchema, id: string, patch: { body?: string; dueAt?: string | null; done?: boolean }): Activity {
  const task = taskById(data, id)
  if (patch.body !== undefined) {
    if (!patch.body.trim()) throw new Error('Say what needs doing.')
    task.body = patch.body.trim()
  }
  if (patch.dueAt !== undefined) {
    const due = checkDue(patch.dueAt)
    if (due !== task.due_at) task.reminded_at = null
    task.due_at = due
  }
  if (patch.done !== undefined) task.done_at = patch.done ? (task.done_at ?? new Date().toISOString()) : null
  return task
}

export function deleteTask(data: DbSchema, id: string) {
  taskById(data, id)
  data.activities = data.activities!.filter((a) => a.id !== id)
}

function contactName(data: DbSchema, email: string): string | null {
  const c = data.contacts.find((x) => x.email === email)
  return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || null
}

export function taskView(data: DbSchema, task: Activity): TaskView {
  const deal = task.deal_id ? data.deals?.find((d) => d.id === task.deal_id) : undefined
  const company = task.company_id ? data.companies?.find((c) => c.id === task.company_id) : undefined
  const link = deal
    ? `/sales/deals/${deal.id}`
    : company
      ? `/marketing/companies/${company.id}`
      : task.contact_email
        ? `/marketing/contacts?contact=${encodeURIComponent(task.contact_email)}`
        : '/sales/tasks'
  return {
    ...task,
    deal_name: deal?.name ?? null,
    company_name: company?.name ?? null,
    contact_name: task.contact_email ? (contactName(data, task.contact_email) ?? task.contact_email) : null,
    link,
  }
}

/**
 * Open tasks, soonest due first (no due date last), then those done in the
 * last 14 days, most recent first. `on` narrows them to one record.
 */
export function listTasks(data: DbSchema, on: { dealId?: string; companyId?: string; contactEmail?: string } = {}): TaskView[] {
  const email = on.contactEmail ? normEmail(on.contactEmail) : null
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const tasks = (data.activities ?? []).filter(
    (a) =>
      a.kind === 'task' &&
      (!on.dealId || a.deal_id === on.dealId) &&
      (!on.companyId || a.company_id === on.companyId) &&
      (!email || a.contact_email === email) &&
      (!a.done_at || a.done_at >= since),
  )
  const open = tasks.filter((t) => !t.done_at).sort((a, b) => (a.due_at ?? '￿').localeCompare(b.due_at ?? '￿'))
  const done = tasks.filter((t) => t.done_at).sort((a, b) => b.done_at!.localeCompare(a.done_at!))
  return [...open, ...done].map((t) => taskView(data, t))
}

/** Open tasks now due whose reminder hasn't gone out, marked as reminded. */
export function takeDueReminders(data: DbSchema, now = new Date()): TaskView[] {
  const at = now.toISOString()
  const due = (data.activities ?? []).filter((a) => a.kind === 'task' && !a.done_at && a.due_at && a.due_at <= at && !a.reminded_at)
  for (const t of due) t.reminded_at = at
  return due.map((t) => taskView(data, t))
}
