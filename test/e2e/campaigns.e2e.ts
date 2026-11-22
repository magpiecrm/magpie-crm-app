// M1, M2, M5 and C4 (test/JOURNEYS.md): campaigns sent the way a customer sends them,
// caught by the stack's mail server (Mailpit), and what the people who got them
// can do with them: unsubscribe (from the page, or the mail app's one-click
// List-Unsubscribe), open and click.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { SENDER, ensureSender, unique } from './helpers'
import { sent, waitForSent, type CapturedMail } from '../stack/mail'
import { readState } from '../stack/state'

// A person's mail app, as it loads images and follows links: a browser's user agent.
// (A missing or script-like one is counted as a scanner, clickFilter.ts.)
const MAIL_APP = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' }

/** A made-up address nobody has, unique to this run. */
const person = (who: string) => ({
  first: who[0].toUpperCase() + who.slice(1),
  last: 'Tester',
  email: `${who}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@campaign-people.test`,
})
type Person = ReturnType<typeof person>

/** The email's body: plain, readable and with one link, so the spam score has nothing to warn about. */
const body = (link: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Spring update</title></head>
<body style="font-family: sans-serif; color: #222;">
  <p>Hello,</p>
  <p>Here is a short note on what changed in our product this spring, and what is coming next month.</p>
  <p>We tidied up the reports page, made exports faster and fixed the bugs you told us about.</p>
  <p><a href="${link}">Read the full update</a></p>
  <p>Thanks for reading,<br>${SENDER.name}</p>
</body>
</html>`

const LINK = 'https://example.test/updates/spring?ref=campaign'

// ── Steps, through the UI ───────────────────────────────────────────────────

/**
 * The sender, ready to send. `ensureSender` only once it's needed: its check for the domain
 * (helpers.ts `ensureSendingDomain`) is a strict locator, and once anything has been sent
 * Settings → Sending lists the domain twice (its row, and again under Reputation), so a second
 * call in a stack that has sent fails there.
 */
async function readySender(page: Page) {
  await page.goto('/settings?tab=senders')
  await page.waitForLoadState('networkidle')
  if (!(await page.getByRole('main').getByText(`${SENDER.email} on 127.0.0.1`).count())) return ensureSender(page)
  await page.goto('/settings?tab=sending')
  await expect(page.getByRole('main').getByText('Ready to send').first()).toBeVisible()
}

/** Lists → New list. */
async function makeList(page: Page, name: string) {
  await page.goto('/marketing/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('e.g. Newsletter subscribers').fill(name)
  await dialog.getByRole('button', { name: 'Create list' }).click()
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible()
}

/** Contacts → Create a contact, on a list. */
async function addContacts(page: Page, people: Person[], listName: string) {
  await page.goto('/marketing/contacts')
  for (const p of people) {
    await page.getByRole('button', { name: 'Create a contact' }).click()
    const form = page.getByRole('main')
    await form.getByPlaceholder('Enter the FIRSTNAME').fill(p.first)
    await form.getByPlaceholder('Enter the LASTNAME').fill(p.last)
    await form.getByPlaceholder('Enter the email address').fill(p.email)
    await form.locator('label').filter({ hasText: listName }).getByRole('checkbox').check()
    await form.getByRole('button', { name: 'Create', exact: true }).click()
    // The form closes once the contact is made.
    await expect(page.getByRole('heading', { name: 'Create a contact' })).toBeHidden()
  }
  await page.goto('/marketing/lists')
  await expect(page.getByRole('link', { name: new RegExp(listName) })).toContainText(`${people.length} contacts`)
}

/** Campaigns → New Campaign: name, the sender, a list, a subject and the email's HTML; then Create Campaign. */
async function createCampaign(page: Page, c: { name: string; subject: string; listName: string; listSize: number; html: string }) {
  await page.goto('/marketing/campaigns')
  await page.getByRole('button', { name: 'New Campaign' }).click()
  const main = page.getByRole('main')

  // Sender: open to begin with.
  await main.getByPlaceholder('e.g. Q4 Product Updates').fill(c.name)
  const sender = main.getByRole('combobox').first()
  await expect(sender).toContainText('@')
  if (!(await sender.textContent())?.includes(SENDER.email)) {
    await sender.click()
    await page.getByRole('option', { name: new RegExp(SENDER.email) }).click()
  }
  await expect(sender).toContainText(SENDER.email)

  await main.getByRole('button', { name: 'Manage recipients' }).click()
  await main.getByRole('button', { name: new RegExp(c.listName) }).click()
  await expect(main.getByText(`${c.listName} • ${c.listSize} contacts`)).toBeVisible()

  await main.getByRole('button', { name: 'Edit subject' }).click()
  await main.getByPlaceholder('Is your stack built around functions or just features?').fill(c.subject)
  await main.getByRole('button', { name: 'Save', exact: true }).click()

  await main.getByRole('button', { name: 'Edit design' }).click()
  await main.getByPlaceholder('<!DOCTYPE html><html><body>...</body></html>').fill(c.html)
  await expect(main.getByText('Your own HTML')).toBeVisible()
  // Open tracking is on for a new campaign, and a hosted copy's unsubscribe link can't be switched off.
  await expect(main.getByRole('switch', { name: 'Track opens' })).toHaveAttribute('aria-checked', 'true')
  await expect(main.getByRole('switch', { name: 'Include Unsubscribe Link' })).toHaveAttribute('aria-checked', 'true')

  await main.getByRole('button', { name: 'Create Campaign' }).click()
  await expect(campaignCard(page, c.name)).toBeVisible()
}

/** A campaign's card on the Campaigns page. */
const campaignCard = (page: Page, name: string) => page.locator('div.bg-card', { has: page.getByRole('link', { name, exact: true }) })

/** The campaign's id, from its card's link. */
async function campaignId(page: Page, name: string) {
  await page.goto('/marketing/campaigns')
  const href = await campaignCard(page, name).getByRole('link', { name, exact: true }).getAttribute('href')
  return Number(href?.split('/').pop())
}

/** The editor's Schedule → Now: it says how many people it goes to, then sends. Returns when Send was pressed. */
async function sendNow(page: Page, name: string, people: number) {
  await page.goto('/marketing/campaigns')
  await campaignCard(page, name).getByTitle('Edit').click()
  // The editor has the campaign loaded once its name is in the heading.
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await page.getByRole('button', { name: 'Schedule' }).click()
  const dialog = page.getByRole('dialog', { name: 'Send or schedule' })
  const send = dialog.getByRole('button', { name: `Send to ${people} ${people === 1 ? 'person' : 'people'}` })
  await expect(send).toBeEnabled()
  const pressed = Date.now()
  await send.click()
  await expect(page.getByText(`Campaign sent to ${people} recipient${people === 1 ? '' : 's'}`)).toBeVisible()
  return pressed
}

// ── Reading what was caught ─────────────────────────────────────────────────

const appUrl = () => readState().appUrl
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The emails caught for one address with this subject. */
const caught = async (to: string, subject: string) => (await sent(to)).filter((m) => m.subject === subject)

function unsubscribeLink(mail: CapturedMail) {
  const link = mail.html.match(new RegExp(`href="(${escape(appUrl())}/api/unsubscribe\\?t=[^"]+)"`))?.[1]
  expect(link, `an unsubscribe link in the email to ${mail.to}`).toBeTruthy()
  return link!
}

function pixel(mail: CapturedMail) {
  const src = mail.html.match(new RegExp(`<img src="(${escape(appUrl())}/api/track/open\\?t=[^"]+)"`))?.[1]
  expect(src, `a tracking pixel in the email to ${mail.to}`).toBeTruthy()
  return src!
}

/** The tracked link a person sees (not the hidden trap link), by its text. */
function trackedLink(mail: CapturedMail, text: string) {
  const href = mail.html.match(new RegExp(`<a\\s[^>]*href="(${escape(appUrl())}/api/track/click\\?t=[^"]+)"[^>]*>\\s*${escape(text)}`))?.[1]
  expect(href, `a tracked "${text}" link in the email to ${mail.to}`).toBeTruthy()
  return href!
}

/** Everything M1 asks of a campaign email: the subject, an unsubscribe link that opens its page, the headers and the pixel. */
async function checkCampaignEmail(request: APIRequestContext, mail: CapturedMail, to: Person, subject: string) {
  expect(mail.subject).toBe(subject)
  expect(mail.to).toEqual([to.email])
  expect(mail.from).toBe(SENDER.email)

  const link = unsubscribeLink(mail)
  // Mail apps show their own Unsubscribe button from these (RFC 8058), pointing at the same link.
  expect(mail.headers['list-unsubscribe']).toBe(`<${link}>`)
  expect(mail.headers['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click')
  // The link opens the confirmation page for this person (following it doesn't unsubscribe by itself).
  const page = await request.get(link, { headers: MAIL_APP })
  expect(page.status()).toBe(200)
  const html = await page.text()
  expect(html).toContain('Unsubscribe Confirmation')
  expect(html).toContain(`value="${to.email}"`)

  pixel(mail)
}

// ── Journeys ────────────────────────────────────────────────────────────────

test('M1: a campaign to a list of three, one unsubscribed, reaches the other two', async ({ page, problems, request }) => {
  await readySender(page)
  const listName = unique('M1 list')
  const [ada, ben, cy] = [person('ada'), person('ben'), person('cy')]
  await makeList(page, listName)
  await addContacts(page, [ada, ben, cy], listName)

  // Cy unsubscribes from an earlier campaign with their mail app's Unsubscribe button:
  // the one-click POST its List-Unsubscribe header promises.
  const earlier = { name: unique('M1 earlier'), subject: unique('Earlier news') }
  await createCampaign(page, { ...earlier, listName, listSize: 3, html: body(LINK) })
  await sendNow(page, earlier.name, 3)
  const [toCy] = await waitForSent(cy.email, { match: (m) => m.subject === earlier.subject })
  const oneClick = await request.post(unsubscribeLink(toCy), {
    headers: { ...MAIL_APP, 'Content-Type': 'application/x-www-form-urlencoded' },
    data: 'List-Unsubscribe=One-Click',
  })
  expect(oneClick.status()).toBe(200)

  // The campaign itself: the editor already says it goes to two.
  const campaign = { name: unique('M1 campaign'), subject: unique('Spring update') }
  await createCampaign(page, { ...campaign, listName, listSize: 3, html: body(LINK) })
  await sendNow(page, campaign.name, 2)

  // Two emails caught, one each to Ada and Ben, none to Cy.
  const [toAda] = await waitForSent(ada.email, { match: (m) => m.subject === campaign.subject })
  const [toBen] = await waitForSent(ben.email, { match: (m) => m.subject === campaign.subject })
  expect(await caught(ada.email, campaign.subject)).toHaveLength(1)
  expect(await caught(ben.email, campaign.subject)).toHaveLength(1)
  expect(await caught(cy.email, campaign.subject)).toHaveLength(0)
  await checkCampaignEmail(request, toAda, ada, campaign.subject)
  await checkCampaignEmail(request, toBen, ben, campaign.subject)

  // It shows sent, to two, on its card and its own page.
  const card = campaignCard(page, campaign.name)
  await page.goto('/marketing/campaigns')
  await expect(card.getByText('sent', { exact: true })).toBeVisible()
  await expect(card.locator('span', { hasText: /^Recipients$/ }).locator('xpath=following-sibling::span[1]')).toHaveText('2')
  await card.getByRole('link', { name: campaign.name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: campaign.name })).toBeVisible()
  await expect(page.getByText('Went out to 2 recipients.')).toBeVisible()

  expect(problems()).toEqual([])
})

test('C4: the unsubscribe link in a sent email unsubscribes them, and the next campaign leaves them out', async ({ page, problems, browser }) => {
  await readySender(page)
  const listName = unique('C4 list')
  const [dee, eli] = [person('dee'), person('eli')]
  await makeList(page, listName)
  await addContacts(page, [dee, eli], listName)

  const first = { name: unique('C4 first'), subject: unique('First news') }
  await createCampaign(page, { ...first, listName, listSize: 2, html: body(LINK) })
  await sendNow(page, first.name, 2)
  const [toDee] = await waitForSent(dee.email, { match: (m) => m.subject === first.subject })
  await waitForSent(eli.email, { match: (m) => m.subject === first.subject })

  // Dee follows the link in their email: a browser that has never signed in, kept on this machine.
  const { appUrl } = readState()
  const outside = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  await outside.route((url) => !url.href.startsWith(appUrl), (route) => route.abort())
  try {
    const unsub = await outside.newPage()
    await unsub.goto(unsubscribeLink(toDee))
    await expect(unsub.getByRole('heading', { name: 'Unsubscribe Confirmation' })).toBeVisible()
    await expect(unsub.locator('#email')).toHaveValue(dee.email)
    await unsub.getByRole('button', { name: 'Unsubscribe' }).click()
    await expect(unsub.getByRole('heading', { name: 'Unsubscribed Successfully' })).toBeVisible()
  } finally {
    await outside.close()
  }

  // Contacts shows them unsubscribed; the first campaign counts the unsubscribe.
  await page.goto('/marketing/contacts')
  await page.getByPlaceholder('Search...').fill(dee.email)
  await expect(page.getByRole('row').filter({ hasText: dee.email })).toContainText('Unsubscribed')
  await page.goto(`/marketing/campaigns/${await campaignId(page, first.name)}`)
  await page.getByRole('button', { name: 'Unsubscribes', exact: true }).click()
  await expect(page.getByRole('main')).toContainText(dee.email)

  // The next campaign to the same list goes to Eli alone.
  const next = { name: unique('C4 next'), subject: unique('More news') }
  await createCampaign(page, { ...next, listName, listSize: 2, html: body(LINK) })
  await sendNow(page, next.name, 1)
  await waitForSent(eli.email, { match: (m) => m.subject === next.subject })
  expect(await caught(eli.email, next.subject)).toHaveLength(1)
  expect(await caught(dee.email, next.subject)).toHaveLength(0)
  expect(await sent(dee.email)).toHaveLength(1)

  expect(problems()).toEqual([])
})

test('M2: an open counts only after the first minute, a click counts and redirects, and both show', async ({ page, problems, request }) => {
  test.setTimeout(4 * 60_000) // a real minute's wait between the two image loads
  await readySender(page)
  const listName = unique('M2 list')
  const fay = person('fay')
  await makeList(page, listName)
  await addContacts(page, [fay], listName)

  const campaign = { name: unique('M2 campaign'), subject: unique('Spring update') }
  await createCampaign(page, { ...campaign, listName, listSize: 1, html: body(LINK) })
  const pressed = await sendNow(page, campaign.name, 1)
  const sentAt = Date.now()
  const [mail] = await waitForSent(fay.email, { match: (m) => m.subject === campaign.subject })

  // The images load as the email arrives: the mail server or a scanner, not Fay reading it.
  // The stand-in host reports each delivery to the app within ~2 s, as the host's mail
  // server does (/api/webhooks/email/smtp), and a load within a minute of delivery is taken
  // as automated (clickFilter.ts). Give the report time to land, then load it.
  await page.waitForTimeout(4_000)
  expect(Date.now() - pressed, 'the first load comes well inside the minute').toBeLessThan(40_000)
  const soon = await request.get(pixel(mail), { headers: MAIL_APP })
  expect(soon.status()).toBe(200)
  expect(soon.headers()['content-type']).toBe('image/gif')
  const id = await campaignId(page, campaign.name)
  await page.goto(`/marketing/campaigns/${id}`)
  await page.getByRole('button', { name: 'Opens', exact: true }).click()
  await expect(tile(page, 'Opened')).toHaveText('0')
  await expect(page.getByText('(1 this time)')).toBeVisible()

  // Over a minute later, Fay opens it.
  await page.waitForTimeout(Math.max(0, sentAt + 65_000 - Date.now()))
  const later = await request.get(pixel(mail), { headers: MAIL_APP })
  expect(later.status()).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: 'Opens', exact: true }).click()
  await expect(tile(page, 'Opened')).toHaveText('1')
  await expect(tile(page, 'Total opens')).toHaveText('1')

  // And follows the link: counted, and sent on to the real page (not followed off this machine).
  const click = await request.get(trackedLink(mail, 'Read the full update'), { headers: MAIL_APP, maxRedirects: 0 })
  expect(click.status()).toBe(302)
  expect(click.headers()['location']).toBe(LINK)

  await page.reload()
  await page.getByRole('button', { name: 'Clicks', exact: true }).click()
  await expect(tile(page, 'Clicked')).toHaveText('1')
  await expect(tile(page, 'Total clicks')).toHaveText('1')
  // The link's row: one person, one click.
  const linkRow = page.getByRole('row').filter({ has: page.locator(`a[href="${LINK}"]`) })
  await expect(linkRow.getByRole('cell').nth(1)).toHaveText('1')
  await expect(linkRow.getByRole('cell').nth(2)).toHaveText('1')

  // Analytics has the same: one opened, one clicked.
  await page.goto('/marketing/analytics')
  const row = page.getByRole('row').filter({ hasText: campaign.name })
  await expect(row.getByRole('cell').nth(3).locator('span').first()).toHaveText('1')
  await expect(row.getByRole('cell').nth(4).locator('span').first()).toHaveText('1')

  expect(problems()).toEqual([])
})

/** A figure on one of the campaign page's tabs (Opens, Clicks…), by its label. */
const tile = (page: Page, label: string) =>
  page
    .getByRole('main')
    .locator('div.rounded-xl')
    .filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`, 'i') }) })
    .locator('span')
    .nth(1)

test('M5: "Send a test" reaches only the address given, its subject marked [TEST] once', async ({ page, problems }) => {
  await readySender(page)
  const listName = unique('M5 list')
  const onList = person('mira')
  await makeList(page, listName)
  await addContacts(page, [onList], listName)
  const campaign = { name: unique('M5 campaign'), subject: unique('Spring update'), listName, listSize: 1, html: body(LINK) }
  await createCampaign(page, campaign)

  await page.goto('/marketing/campaigns')
  await campaignCard(page, campaign.name).getByTitle('Edit').click()
  await expect(page.getByRole('heading', { level: 1, name: campaign.name })).toBeVisible()
  await page.getByRole('button', { name: 'Preview and test' }).click()
  const dialog = page.getByRole('dialog', { name: 'Preview and test' })
  await dialog.getByRole('tab', { name: 'Send a test' }).click()
  const tester = person('tess')
  await dialog.getByPlaceholder('e.g. you@example.com').fill(tester.email)
  await dialog.getByRole('button', { name: 'Send test email' }).click()
  await expect(page.getByText('Test email sent', { exact: true })).toBeVisible()

  const [mail] = await waitForSent(tester.email)
  expect(mail.subject).toBe(`[TEST] ${campaign.subject}`)
  expect(mail.to).toEqual([tester.email])
  // The list's own people get nothing from a test.
  expect(await sent(onList.email)).toEqual([])

  expect(problems()).toEqual([])
})
