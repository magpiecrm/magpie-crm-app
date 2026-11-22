// F1 (test/JOURNEYS.md): a form built, published, filled in by a signed-out visitor, and what comes of it.
import type { Browser, Page } from '@playwright/test'
import { expect, test, watch } from './fixtures'
import { SENDER, ensureSender, unique } from './helpers'
import { waitForSent } from '../stack/mail'
import { readState } from '../stack/state'

/** Forms → New form → Blank form (just the email), named, with these built-in fields added from Add field. */
async function startBlankForm(page: Page, name: string, fields: string[]) {
  await page.goto('/marketing/forms/new')
  await page.getByRole('link', { name: /Blank form/ }).click()
  await page.getByRole('textbox', { name: 'Form name' }).fill(name)
  for (const field of fields) {
    await page.getByRole('button', { name: 'Add a field' }).click()
    await page.getByRole('menuitem', { name: field, exact: true }).click()
  }
}

/** Create form: it's live at once, and the dialog that follows gives its link. Returns the link and the form's page. */
async function publish(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create form' }).click()
  const share = page.getByRole('dialog', { name: 'Your form is ready' })
  await expect(share).toBeVisible()
  await share.getByRole('tab', { name: 'Link' }).click()
  const link = await share.getByRole('link', { name: "Open the form's page" }).getAttribute('href')
  expect(link).toMatch(/\/f\/[^/?#]+$/)
  await share.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  return { link: link!, formPage: new URL(page.url()).pathname }
}

/** The form's link opened by someone who isn't signed in: a browser with no session at all. */
async function asVisitor(browser: Browser, link: string, visit: (form: Page) => Promise<void>) {
  const outside = await browser.newContext({ baseURL: readState().appUrl, storageState: { cookies: [], origins: [] } })
  try {
    const form = await outside.newPage()
    const problems = watch(form)
    await form.goto(link)
    await visit(form)
    expect(problems()).toEqual([])
  } finally {
    await outside.close()
  }
}

test('a form built and published makes a contact from a visitor, and sends them its welcome email', async ({ page, problems, browser }) => {
  // Sending from a hosted copy needs a ready domain and a sender.
  await ensureSender(page)
  const name = unique('F1 form')
  const list = unique('F1 sign-ups')
  const visitor = { email: `${unique('f1').replace(/\s+/g, '-')}@visitors.test`, first: 'Fern', last: 'Visitor', company: 'Bramblefield', job: 'Head of Growth' }

  await startBlankForm(page, name, ['First name', 'Last name', 'Company', 'Job title'])

  // After sending: onto a new list, and a welcome email straight away from the sender.
  await page.getByRole('tab', { name: 'After sending' }).click()
  await expect(page.getByRole('switch', { name: 'Add people who send the form to a list' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder('Website sign-ups').fill(list)
  await page.getByRole('button', { name: 'Create list' }).click()
  await expect(page.getByRole('combobox', { name: 'List', exact: true })).toHaveText(list)
  await page.getByRole('switch', { name: 'Send a welcome email' }).click()
  await page.getByRole('combobox', { name: 'From' }).click()
  await page.getByRole('option', { name: `${SENDER.name} · ${SENDER.email}` }).click()
  await page.getByRole('combobox', { name: 'When to send it' }).click()
  await page.getByRole('option', { name: 'Straight away' }).click()
  await page.getByLabel('Subject', { exact: true }).fill('Welcome to the beta, {{first_name}}')

  const { link, formPage } = await publish(page, name)
  await expect(page.getByText(`Adds people to ${list} · Welcome email straight away`)).toBeVisible()

  await asVisitor(browser, link, async (form) => {
    await form.getByLabel('First name').fill(visitor.first)
    await form.getByLabel('Last name').fill(visitor.last)
    await form.getByLabel('Email').fill(visitor.email)
    await form.getByLabel('Company').fill(visitor.company)
    await form.getByLabel('Job title').fill(visitor.job)
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(form.getByRole('status')).toContainText("Thanks! We'll be in touch shortly.")
  })

  // A contact, with what they typed, on the form's list.
  await page.goto(`/marketing/contacts?contact=${encodeURIComponent(visitor.email)}`)
  await expect(page.getByRole('heading', { name: `${visitor.first} ${visitor.last}`, level: 1 })).toBeVisible()
  const panel = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Information', exact: true }) }).last()
  await expect(panel).toContainText(visitor.company)
  await expect(panel).toContainText(visitor.job)
  await expect(page.getByText(list, { exact: true })).toBeVisible()

  // The form counts the submission.
  await page.goto(formPage)
  await expect(page.getByRole('link', { name: /^Submissions\s*1$/ })).toBeVisible()

  // The welcome email, from the sender, with their name filled in (the scheduler sends once a minute).
  const [mail] = await waitForSent(visitor.email)
  expect(mail.from).toBe(SENDER.email)
  expect(mail.subject).toBe(`Welcome to the beta, ${visitor.first}`)
  expect(mail.text).toContain(`Hi ${visitor.first},`)
  expect(mail.headers['list-unsubscribe']).toBeTruthy()

  expect(problems()).toEqual([])
})

test('a new form keeps its heading, intro, privacy link and thank-you page from the first save', async ({ page, problems, browser }) => {
  const name = unique('F1 heading')
  const privacy = 'https://acme-sends.test/privacy'
  const thanks = 'https://acme-sends.test/thanks'
  await startBlankForm(page, name, [])
  await page.getByPlaceholder('Get in touch').fill('Join the beta')
  await page.getByPlaceholder("Tell us a little about what you need and we'll reply within a day.").fill('One email a month, no more.')
  await page.getByRole('tab', { name: 'After sending' }).click()
  await page.getByRole('radio', { name: 'Go to a page' }).click()
  await page.getByPlaceholder('https://yoursite.com/thanks').fill(thanks)
  await page.getByRole('tab', { name: 'Style' }).click()
  await page.getByPlaceholder('https://yoursite.com/privacy').fill(privacy)
  const { link } = await publish(page, name)

  await asVisitor(browser, link, async (form) => {
    await expect(form.getByRole('heading', { name: 'Join the beta', level: 1 })).toBeVisible()
    await expect(form.getByText('One email a month, no more.')).toBeVisible()
    await expect(form.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', privacy)
    // The thank-you page is the customer's own: stood in for here.
    await form.route(`${thanks}*`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Thanks</title><p>Thanks for joining</p>' }))
    await form.getByLabel('Email').fill(`${unique('f1-thanks').replace(/\s+/g, '-')}@visitors.test`)
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(form).toHaveURL(thanks)
  })
  expect(problems()).toEqual([])
})

test("a form made from a template keeps the template's heading and intro", async ({ page, problems, browser }) => {
  const name = unique('F1 template')
  await page.goto('/marketing/forms/new')
  await page.getByRole('link', { name: /Contact us/ }).click()
  await page.getByRole('textbox', { name: 'Form name' }).fill(name)
  const { link } = await publish(page, name)

  await asVisitor(browser, link, async (form) => {
    await expect(form.getByRole('heading', { name: 'Get in touch', level: 1 })).toBeVisible()
    await expect(form.getByText("Tell us what you need and we'll reply within one working day.")).toBeVisible()
  })
  expect(problems()).toEqual([])
})
