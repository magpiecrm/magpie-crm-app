// Q1, Q2, Q3 and ST2 (test/JOURNEYS.md): a two-email sequence sent from the
// workspace's sender to two contacts, a reply planted in the sender's inbox
// (GreenMail) and found, and an answer sent back from Sales → Inbox.
//
// The journeys build on each other (sent emails, then a reply, then an
// answer), so each one makes what it needs through the steps before it, done
// once per worker and reused: run together they share one sequence, run alone
// each still works. Everything is made fresh with `unique()`, so reruns on the
// same workspace never collide.
import type { Locator, Page } from '@playwright/test'
import { ImapFlow } from 'imapflow'
import { expect, test } from './fixtures'
import { SENDER, ensureSender, unique } from './helpers'
import { deliver, inbox, sent, waitForSent, type CapturedMail } from '../stack/mail'
import { readState } from '../stack/state'

// The engine sends one email per sequence per scheduler run (each minute) and
// paces a sequence's emails at least a minute apart (sequences/schedule.ts
// nextGapMs), so two first emails take two or three runs.
const TWO_RUNS_MS = 200_000
test.setTimeout(8 * 60_000)

interface Person {
  first: string
  last: string
  email: string
}
interface Sent {
  sequenceId: string
  name: string
  subject: string
  a: Person
  b: Person
  first: Record<'a' | 'b', CapturedMail>
}
interface Replied extends Sent {
  reply: { messageId: string; text: string }
}

const bare = (id: string) => id.trim().replace(/^<|>$/g, '').toLowerCase()
const angled = (id: string) => `<${bare(id)}>`

/**
 * helpers.ts `ensureSender`, made safe to repeat after mail has gone out. Its `ensureSendingDomain`
 * asks `getByText(SENDER.domain, { exact: true }).isVisible()`, and once the domain has sent
 * anything Settings → Sending names it twice (Sending domains, and Reputation), so every later
 * run fails on a strict-mode violation. Here the domain's own "Show … DNS records" button is
 * asked instead; the rest is the helper's. Back to `ensureSender` once helpers.ts asks the same.
 */
async function ensureSenderReady(page: Page) {
  await page.goto('/settings?tab=sending')
  const main = page.getByRole('main')
  await page.waitForLoadState('networkidle')
  if (!(await main.getByRole('button', { name: `Show ${SENDER.domain}'s DNS records` }).count())) return ensureSender(page)
  await expect(main.getByRole('paragraph').filter({ hasText: SENDER.domain }).filter({ hasText: 'Ready to send' })).toBeVisible()

  await page.goto('/settings?tab=senders')
  await page.waitForLoadState('networkidle')
  if (!(await main.getByRole('button', { name: `Delete ${SENDER.name}` }).count())) {
    await main.getByPlaceholder('Marketing team').fill(SENDER.name)
    await main.getByPlaceholder('hello@yourdomain.com').fill(SENDER.email)
    await main.getByRole('button', { name: 'Add sender' }).click()
    await expect(main.getByText('Sender added.')).toBeVisible()
  }
  if (await main.getByRole('button', { name: 'Connect inbox' }).isVisible()) {
    await main.getByRole('button', { name: 'Connect inbox' }).click()
    await main.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Another mail service (IMAP)' }).click()
    await main.getByPlaceholder('imap.example.com').fill('127.0.0.1')
    const tls = main.getByRole('switch', { name: 'SSL/TLS' })
    if ((await tls.getAttribute('aria-checked')) === 'true') await tls.click()
    await main.locator('input[type="number"]').fill(String(readState().mail.imapPort))
    await main.locator('input[type="password"]').fill('stand-in')
    await main.getByRole('button', { name: 'Check and connect' }).click()
  }
  await expect(main.getByText(`${SENDER.email} on 127.0.0.1`)).toBeVisible()
}

/** Contacts → Create a contact, as a person fills the form. */
async function createContact(page: Page, p: Person) {
  await page.goto('/marketing/contacts')
  await page.getByRole('button', { name: 'Create a contact' }).click()
  await page.getByPlaceholder('Enter the FIRSTNAME').fill(p.first)
  await page.getByPlaceholder('Enter the LASTNAME').fill(p.last)
  await page.getByPlaceholder('Enter the email address').fill(p.email)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible()
}

/** Chooses an option in one of the app's dropdowns (components/ui/Select: a combobox and a listbox). */
async function choose(page: Page, combobox: Locator, option: string) {
  await combobox.click()
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click()
}

/** The sequence's Settings tab: every day, a window ending within two hours of now, and room for 500 a day. */
async function sendNow(page: Page) {
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Settings', exact: true }).click()
  const days = main.getByRole('group', { name: 'Days' })
  for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    const button = days.getByRole('button', { name: day, exact: true })
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
  }
  // Pacing shares what's left of today's window over the emails left today (at least a minute
  // apart). A window that closes soon, with a high cap, keeps that gap at its one-minute floor.
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date())) % 24
  const until = Math.min(24, hour + 2)
  await choose(page, main.getByRole('combobox', { name: 'From', exact: true }), '00:00')
  await choose(page, main.getByRole('combobox', { name: 'Until', exact: true }), until === 24 ? 'midnight' : `${String(until).padStart(2, '0')}:00`)
  await main.getByRole('spinbutton', { name: 'At most', exact: true }).fill('500')
  // The sender's inbox is connected, so replies to it are read.
  await expect(main.getByText(`Replies are detected from ${SENDER.email}`)).toBeVisible()
  await main.getByRole('button', { name: 'Save settings' }).click()
  await expect(main.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
}

let sentOnce: Promise<Sent> | null = null
let repliedOnce: Promise<Replied> | null = null

/**
 * Q1: a sequence of two emails from SENDER, two contacts enrolled from Contacts,
 * started; both first emails caught, from the sender, with an unsubscribe link.
 */
async function firstEmailsSent(page: Page): Promise<Sent> {
  await ensureSenderReady(page)
  const slug = unique('q').split(' ')[1]
  const a: Person = { first: 'Ada', last: `Quill ${slug}`, email: `ada.${slug}@lanternrow.test` }
  const b: Person = { first: 'Ben', last: `Marsh ${slug}`, email: `ben.${slug}@lanternrow.test` }
  const name = unique('Q1 sequence')
  const subject = unique('A question about your spring order')
  for (const p of [a, b]) await createContact(page, p)

  // Sales → Sequences → New sequence, from SENDER.
  await page.goto('/sales/sequences')
  await page.getByRole('button', { name: 'New sequence' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('e.g. UK agency founders').fill(name)
  await choose(page, dialog.getByRole('combobox'), `${SENDER.name} · ${SENDER.email}`)
  await dialog.getByRole('button', { name: 'Create sequence' }).click()
  await expect(page).toHaveURL(/\/sales\/sequences\/[\w-]+/)
  const sequenceId = page.url().match(/\/sales\/sequences\/([\w-]+)/)![1]
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name })).toBeVisible()

  // The two emails, written by hand: the AI's own versions stay off.
  const ai = main.getByRole('switch', { name: "Write each person's emails with AI" })
  if ((await ai.getAttribute('aria-checked')) === 'true') await ai.click()
  await expect(ai).toHaveAttribute('aria-checked', 'false')
  await expect(main.getByRole('heading', { name: 'First email' })).toBeVisible()
  await expect(main.getByRole('heading', { name: 'Follow-up 1' })).toBeVisible()
  await main.getByRole('textbox', { name: 'Subject' }).fill(subject)
  const texts = main.getByRole('textbox', { name: 'Email text' })
  await texts.nth(0).fill('Hi there,\n\nI saw your team is planning the spring range. Would a short call next week help?\n\nThanks')
  await texts.nth(1).fill('Hi again,\n\nHappy to send over a few examples first if that is easier.')
  await main.getByRole('button', { name: 'Save emails' }).click()
  await expect(main.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

  await sendNow(page)

  // Contacts: the two chosen, added to the sequence.
  await page.goto('/marketing/contacts')
  await page.getByPlaceholder('Search...').fill(slug)
  for (const p of [a, b]) await page.getByRole('checkbox', { name: `Select ${p.email}` }).check()
  await page.getByRole('button', { name: 'Add to sequence (2)' }).click()
  const enroll = page.getByRole('dialog')
  await choose(page, enroll.getByRole('combobox'), name)
  await expect(enroll.getByText('2 people will be added.')).toBeVisible()
  await enroll.getByRole('button', { name: 'Add 2 people' }).click()
  await expect(enroll.getByText(`Added 2 people to “${name}”`)).toBeVisible()
  await enroll.getByRole('button', { name: 'Done' }).click()

  // Started.
  await page.goto(`/sales/sequences/${sequenceId}`)
  await main.getByRole('button', { name: 'Start sending' }).click()
  await expect(main.getByText('Running', { exact: true })).toBeVisible()

  const first = {} as Sent['first']
  for (const [key, p] of [['a', a], ['b', b]] as const) {
    const [mail] = await waitForSent(p.email, { timeoutMs: TWO_RUNS_MS, match: (m) => m.subject === subject })
    expect(mail.from).toBe(SENDER.email)
    expect(mail.to).toEqual([p.email])
    expect(mail.text).toContain('spring range')
    // The last line's {{ unsubscribe }}: words linked to this copy's unsubscribe address, and the one-click header.
    const unsubscribe = `${readState().appUrl}/api/unsubscribe?t=`
    expect(mail.html).toMatch(/>Unsubscribe here<\/a>/i)
    expect(mail.html).toContain(`href="${unsubscribe}`)
    expect(mail.headers['list-unsubscribe']).toContain(unsubscribe)
    first[key] = mail
  }
  return { sequenceId, name, subject, a, b, first }
}

/** Plants Ada's reply in the sender's inbox, in the thread of her first email, and has the inboxes read. */
async function replyFound(page: Page): Promise<Replied> {
  const s = await (sentOnce ??= firstEmailsSent(page))
  const text = `Thanks, this sounds useful. Could we talk on Thursday afternoon? (${unique('ref')})`
  const firstId = angled(s.first.a.messageId)
  await deliver({ from: s.a.email, to: SENDER.email, subject: `Re: ${s.subject}`, inReplyTo: firstId, references: firstId, text })
  const planted = (await inbox(SENDER.email)).find((m) => m.from === s.a.email && m.text.includes(text))
  expect(planted, 'the reply is in the sender inbox').toBeTruthy()

  await page.goto('/settings?tab=senders')
  const check = page.getByRole('main').getByRole('button', { name: 'Check inboxes now' })
  await check.click()
  await expect(check).toBeEnabled()

  // Her enrolment stops: Replied, with no next email. Ben carries on.
  await page.goto(`/sales/sequences/${s.sequenceId}?tab=people`)
  const main = page.getByRole('main')
  const ada = main.getByRole('row').filter({ hasText: s.a.email })
  // The table refreshes each minute; a reload shows the read's outcome as soon as it's in.
  await expect(async () => {
    await page.reload()
    await expect(ada.getByText('Replied', { exact: true })).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(main.getByRole('row').filter({ hasText: s.b.email }).getByText('In progress', { exact: true })).toBeVisible()
  return { ...s, reply: { messageId: planted!.messageId, text } }
}

test('Q1: a sequence sends both first emails from the sender, each with an unsubscribe link', async ({ page, problems }) => {
  await (sentOnce ??= firstEmailsSent(page))
  expect(problems()).toEqual([])
})

test('Q2: a reply in the sender inbox stops that enrolment and shows in the Inbox and on Replies', async ({ page, problems }) => {
  const s = await (repliedOnce ??= replyFound(page))
  const main = page.getByRole('main')

  // The sequence's Replies tab.
  await page.goto(`/sales/sequences/${s.sequenceId}?tab=replies`)
  const row = main.getByRole('listitem').filter({ hasText: `${s.a.first} ${s.a.last}` })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Thanks, this sounds useful.')

  // Sales → Inbox: waiting for an answer.
  await page.goto('/sales/inbox')
  await expect(main.getByRole('tab', { name: /Needs reply/ })).toHaveAttribute('aria-selected', 'true')
  await main.getByPlaceholder('Search by name, company or email').fill(s.a.email)
  const conversation = main.getByRole('button').filter({ hasText: `${s.a.first} ${s.a.last}` })
  await expect(conversation).toBeVisible()
  await expect(conversation).toContainText('Thanks, this sounds useful.')
  await expect(conversation.getByLabel('Needs a reply')).toBeVisible()

  // The follow-up made due now: Ben, still in progress, gets it in the thread; Ada, who replied, doesn't.
  await page.goto(`/sales/sequences/${s.sequenceId}`)
  await main.getByRole('spinbutton', { name: 'Wait', exact: true }).fill('0')
  await main.getByRole('button', { name: 'Save emails' }).click()
  await expect(main.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  const [followUp] = await waitForSent(s.b.email, { timeoutMs: 150_000, match: (m) => m.subject === `Re: ${s.subject}` })
  expect(followUp.from).toBe(SENDER.email)
  expect(followUp.text).toContain('a few examples')
  expect(bare(followUp.headers['in-reply-to'] ?? '')).toBe(bare(s.first.b.messageId))
  const toAda = (await sent(s.a.email)).filter((m) => m.from === SENDER.email && m.text.includes('a few examples'))
  expect(toAda, 'Ada, who replied, is not sent the follow-up').toEqual([])
  expect(problems()).toEqual([])
})

test('Q3: an answer from the Inbox goes from the sender, threaded under the reply, with a copy in Sent', async ({ page, problems }) => {
  const s = await (repliedOnce ??= replyFound(page))
  await ensureSentFolder(SENDER.email)
  const main = page.getByRole('main')
  const answer = `Thursday at 3pm works. I will send an invite. (${unique('answer')})`

  await page.goto('/sales/inbox?tab=all')
  await main.getByPlaceholder('Search by name, company or email').fill(s.a.email)
  await main.getByRole('button').filter({ hasText: `${s.a.first} ${s.a.last}` }).click()
  await expect(main.getByRole('heading', { name: `${s.a.first} ${s.a.last}` })).toBeVisible()
  await expect(main.getByRole('article').filter({ hasText: 'Thanks, this sounds useful.' })).toBeVisible()
  await main.getByLabel(`Answer ${s.a.first}`).fill(answer)
  await main.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(main.getByLabel(`Answer ${s.a.first}`)).toHaveValue('')
  await expect(main.getByRole('article').filter({ hasText: answer })).toBeVisible()

  const [mail] = await waitForSent(s.a.email, { timeoutMs: 30_000, match: (m) => m.text.includes(answer) })
  expect(mail.from).toBe(SENDER.email)
  expect(mail.subject).toBe(`Re: ${s.subject}`)
  expect(bare(mail.headers['in-reply-to'] ?? '')).toBe(bare(s.reply.messageId))
  expect(mail.headers['references'] ?? '').toContain(bare(s.reply.messageId))

  // The copy in the sender's own Sent folder, the same message.
  await expect
    .poll(async () => (await inbox(SENDER.email, 'Sent')).filter((m) => bare(m.messageId) === bare(mail.messageId)).length, { timeout: 20_000 })
    .toBe(1)
  await page.reload()
  await expect(main.getByRole('article').filter({ hasText: answer })).toBeVisible()
  await expect(main.getByText("A copy couldn't be put in your inbox's Sent folder.")).toHaveCount(0)
  expect(problems()).toEqual([])
})

/**
 * Every real inbox has a Sent folder, but GreenMail starts each with only INBOX. The app puts its
 * copy in the folder IMAP marks (or names) Sent, so one is made, as the mail provider would have.
 */
async function ensureSentFolder(address: string) {
  const imap = new ImapFlow({ host: '127.0.0.1', port: readState().mail.imapPort, secure: false, auth: { user: address, pass: 'x' }, logger: false })
  await imap.connect()
  try {
    if (!(await imap.list()).some((f) => f.path === 'Sent')) await imap.mailboxCreate('Sent')
  } finally {
    await imap.logout().catch(() => {})
  }
}
