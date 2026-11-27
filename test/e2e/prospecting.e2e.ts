// P1 to P4 (test/JOURNEYS.md): prospect search as a hosted customer uses
// it. The stand-in host answers from the made-up world in test/stack/fixtures.ts
// (six companies, six people at each), so every result can be named. Hosted
// copies use the host's verified people search, and by default leave out
// anyone whose email can't be verified: quillmoor.test accepts every address
// and thistledown.test takes no email, so their people aren't offered.
//
// The workspace is shared and searches remember who they showed, so every
// search here starts from the top, and people stay contacts once saved.
import type { Browser, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { unique } from './helpers'
import { PEOPLE, companyById, realAddress, verdict, type FakePerson } from '../stack/fixtures'
import { readState } from '../stack/state'

/** A search's first page waits up to 75 s for the mail-domain tests of companies it hasn't met before. */
const SEARCH_MS = 150_000

const name = (p: FakePerson) => `${p.first} ${p.last}`
const person = (slug: string) => PEOPLE.find((p) => p.slug === slug)!
const titled = (...titles: string[]) => PEOPLE.filter((p) => titles.includes(p.title))
/** At a company whose mail server says which addresses are real. */
const verifiable = (p: FakePerson) => realAddress(p) !== null
const names = (people: FakePerson[]) => people.map(name).sort()

interface Filters {
  titles: string[]
  /** Seniority labels as the filter shows them ("VP"). */
  seniorities?: string[]
  /** A country from the filter's list ("United Kingdom"). */
  country?: string
  keyword?: string
  /** Signals as the filter labels them ("Hiring"). */
  signals?: string[]
  includeContacts?: boolean
}

/** Opens a filter's section of the form, unless it's open already (`inside` shows). Its button counts what's chosen ("Signals 1"). */
async function openSection(form: Locator, label: string, inside: Locator) {
  if (!(await inside.isVisible())) await form.getByRole('button', { name: new RegExp(`^${label}( \\d+)?$`) }).click()
  await expect(inside).toBeVisible()
}

/** Runs `start` and waits for the people search it sets off to finish (the reply streams, then ends with the page). */
async function untilSearched(page: Page, start: () => Promise<unknown>) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/prospects/search' && r.request().method() === 'POST', { timeout: SEARCH_MS }),
    start(),
  ])
  const lines = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; message?: string })
  expect(lines.find((l) => l.type === 'error')?.message, 'the search failed').toBeUndefined()
  expect(lines.at(-1)?.type, 'the search ended with its page').toBe('done')
}

/**
 * Collection → Prospect Search: fills the people filters and searches, from the top. The form keeps
 * what was chosen while the browser stays open, so a second search in the same test adds to the first.
 */
async function searchPeople(page: Page, f: Filters) {
  await page.goto('/collection/prospect-search')
  await page.waitForLoadState('networkidle')
  const form = page.locator('form').first()
  const titles = form.getByRole('textbox', { name: 'Job titles' })
  for (const t of f.titles) {
    await titles.fill(t)
    await titles.press('Enter')
    await expect(form.getByRole('button', { name: `Remove ${t}`, exact: true })).toBeVisible()
  }
  for (const s of f.seniorities ?? []) await form.getByRole('checkbox', { name: s, exact: true }).check()
  if (f.country) {
    await form.getByRole('button', { name: 'Country', exact: true }).click()
    const country = form.getByRole('textbox', { name: 'Country' })
    await country.fill(f.country)
    await country.press('Enter')
    await expect(form.getByRole('button', { name: `Remove ${f.country}`, exact: true })).toBeVisible()
  }
  if (f.keyword) {
    const keyword = form.getByRole('textbox', { name: 'Keyword', exact: true })
    await openSection(form, 'Keyword', keyword)
    await keyword.fill(f.keyword)
  }
  for (const s of f.signals ?? []) {
    const box = form.getByRole('checkbox', { name: new RegExp(`^${s}\\b`) })
    await openSection(form, 'Signals', box)
    await box.check()
  }
  if (f.includeContacts) {
    const include = form.getByRole('switch', { name: 'Include existing contacts' })
    if ((await include.getAttribute('aria-checked')) !== 'true') await include.click()
    await expect(include).toHaveAttribute('aria-checked', 'true')
  }
  const count = page.getByText(/^\d+ shown/)
  await untilSearched(page, () => form.getByRole('button', { name: 'Search people' }).click())
  await expect(count).toBeVisible()
  // The same search asked before carries on where it stopped, leaving out who it showed then.
  const top = page.getByRole('button', { name: 'Start from the top' })
  if (await top.isVisible()) {
    await untilSearched(page, () => top.click())
    await expect(count).toBeVisible()
    await expect(top).toBeHidden()
  }
}

const resultRows = (page: Page) => page.getByRole('table').locator('tbody tr')

/** The people in the results table, in order, as the made-up world knows them. */
async function shown(page: Page): Promise<FakePerson[]> {
  const cells = await resultRows(page).locator('td:nth-child(2)').allInnerTexts()
  return cells.map((text) => {
    const matches = PEOPLE.filter((p) => text.includes(name(p)))
    expect(matches, `a result that isn't one of the made-up people: ${text}`).toHaveLength(1)
    return matches[0]
  })
}

const rowOf = (page: Page, p: FakePerson) => resultRows(page).filter({ hasText: name(p) })

/** Settings → Prospect search: whether people whose email can't be verified are left out of results (on unless a journey turns it off). */
async function hideUnverifiable(page: Page, on: boolean) {
  await page.goto('/settings?tab=search')
  const toggle = page.getByRole('main').getByRole('switch', { name: 'Hide unverifiable people (recommended)' })
  await expect(toggle).toBeEnabled()
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) {
    await toggle.click()
    await expect(page.getByText('Saved. Your next search uses it.')).toBeVisible()
  }
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
}

/** Settings → Overview: one of this month's usage counts ("Email lookups", "Prospects found"). */
async function usage(page: Page, label: string): Promise<number> {
  await page.goto('/settings?tab=overview')
  const tile = page.getByRole('main').getByText(label, { exact: true }).locator('..')
  const value = tile.locator('p').nth(1)
  await expect(value).toHaveText(/^\d[\d,]*$/)
  return Number((await value.innerText()).replace(/,/g, ''))
}
const emailLookups = (page: Page) => usage(page, 'Email lookups')

/** The public opt-out page, as the person themselves uses it (signed out). */
async function optOut(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: readState().appUrl })
  try {
    const page = await context.newPage()
    await page.goto('/api/opt-out')
    await page.getByLabel('Work email').fill(email)
    await page.getByRole('button', { name: 'Opt out' }).click()
    await expect(page.getByRole('heading', { name: 'You’re opted out' })).toBeVisible()
  } finally {
    await context.close()
  }
}

/** Saves the `count` people selected to a new list; returns the dialog once it's done, and the list's name. */
async function saveToNewList(page: Page, count: number, label: string): Promise<{ dialog: Locator; listName: string }> {
  await page.getByRole('button', { name: `Save ${count} to list` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'New list' }).click()
  const listName = unique(label)
  await dialog.getByPlaceholder('e.g. Q1 Outreach').fill(listName)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog.getByRole('combobox')).toContainText(listName)
  await dialog.getByRole('button', { name: 'Find emails and save' }).click()
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 120_000 })
  return { dialog, listName }
}

/** One person's line in the save dialog's outcomes. */
const outcomeOf = (dialog: Locator, p: FakePerson) =>
  dialog
    .locator('div')
    .filter({ has: dialog.page().getByText(name(p), { exact: true }) })
    .filter({ hasText: /Saved|Already a contact|Opted out|No email found|Couldn't verify|Company domain unknown|Failed/ })
    .last()

test.describe('P1 search people by job title', () => {
  const titles = ['Head of Marketing', 'VP Sales']
  const expected = titled(...titles).filter(verifiable)

  test('finds the made-up people with those titles, with their jobs and countries', async ({ page, problems, host }) => {
    test.setTimeout(4 * 60_000)
    await searchPeople(page, { titles, includeContacts: true })
    expect(names(await shown(page))).toEqual(names(expected))
    for (const p of expected) {
      const cells = rowOf(page, p).locator('td')
      await expect(cells.nth(2)).toContainText(p.title)
      await expect(cells.nth(4)).toContainText(companyById(p.companyId)!.name)
      await expect(cells.nth(5)).toHaveText(p.country)
    }
    // It was the host's verified search that was asked, for those titles.
    const asked = (await host.log('/v2/linkedin/people/searches')).filter((c) => c.method === 'POST')
    expect(asked.at(-1)?.body?.titles).toEqual(titles)
    expect(problems()).toEqual([])
  })

  test('a job title typed but not entered is searched for on the first click', async ({ page, problems, host }) => {
    test.setTimeout(4 * 60_000)
    await page.goto('/collection/prospect-search')
    await page.waitForLoadState('networkidle')
    const form = page.locator('form').first()
    await form.getByRole('textbox', { name: 'Job titles' }).fill('VP Sales')
    // No Enter: clicking Search people takes the title as it is.
    await untilSearched(page, () => form.getByRole('button', { name: 'Search people' }).click())
    await expect(form.getByRole('button', { name: 'Remove VP Sales', exact: true })).toBeVisible()
    await expect(page.getByText('Enter a job title or keyword, or pick a company.')).toBeHidden()
    const asked = (await host.log('/v2/linkedin/people/searches')).filter((c) => c.method === 'POST')
    expect(asked.at(-1)?.body?.titles).toEqual(['VP Sales'])
    expect(problems()).toEqual([])
  })

  test("opening it asks the host once to get its search browsers ready, not on every filter change", async ({ page, problems, host }) => {
    const warmUps = async () => (await host.log('/v2/linkedin/people/warm')).filter((c) => c.method === 'POST')
    const before = (await warmUps()).length
    await page.goto('/collection/prospect-search')
    await page.waitForLoadState('networkidle')
    await expect.poll(async () => (await warmUps()).length, { message: 'a warm-up when the page opens' }).toBe(before + 1)
    expect((await warmUps()).at(-1)?.status).toBe(202)
    // Choosing filters straight after doesn't ask again: the host keeps what it warmed for minutes.
    const form = page.locator('form').first()
    const titles = form.getByRole('textbox', { name: 'Job titles' })
    await titles.fill('VP Sales')
    await titles.press('Enter')
    await form.getByRole('checkbox', { name: 'Director', exact: true }).check()
    await page.waitForLoadState('networkidle')
    expect((await warmUps()).length).toBe(before + 1)
    expect(problems()).toEqual([])
  })

  test('a country narrows them to the people there', async ({ page, problems }) => {
    test.setTimeout(4 * 60_000)
    await searchPeople(page, { titles, country: 'United Kingdom', includeContacts: true })
    const inGB = expected.filter((p) => p.country === 'GB')
    expect(inGB.length).toBeGreaterThan(0)
    expect(names(await shown(page))).toEqual(names(inGB))
    expect(problems()).toEqual([])
  })

  test('a seniority narrows them to the people at that level', async ({ page, problems }) => {
    test.fail(
      true,
      "Hosted copies ignore the Seniority filter: the verified search (verifiedPeopleSource.ts) neither sends it to the host nor filters by it, so ticking VP still shows every Head of Marketing.",
    )
    test.setTimeout(4 * 60_000)
    await searchPeople(page, { titles, seniorities: ['VP'], includeContacts: true })
    const vps = expected.filter((p) => p.title === 'VP Sales')
    expect(names(await shown(page))).toEqual(names(vps))
    expect(problems()).toEqual([])
  })

  test('the next page shows new people, nobody twice', async ({ page, problems }) => {
    test.setTimeout(6 * 60_000)
    // Every title in the made-up world finds its 36 people. Shown with the unverifiable
    // ones marked, rather than left out, that's more than a page of 25.
    const all = ['Head of Marketing', 'VP Sales', 'Founder', 'Chief Technology Officer', 'Growth Lead']
    expect(titled(...all)).toHaveLength(PEOPLE.length)
    await hideUnverifiable(page, false)
    try {
      await searchPeople(page, { titles: all, includeContacts: true })
      const first = await shown(page)
      expect(first).toHaveLength(25)
      await untilSearched(page, () => page.getByRole('button', { name: 'Load more' }).click())
      await expect(resultRows(page)).toHaveCount(PEOPLE.length)
      const both = await shown(page)
      expect(both.slice(0, first.length), 'the first page stays as it was').toEqual(first)
      expect(new Set(both.map(name)).size, 'nobody is shown twice').toBe(both.length)
      expect(names(both)).toEqual(names(PEOPLE))
      expect(problems()).toEqual([])
    } finally {
      await hideUnverifiable(page, true)
    }
  })
})

test.describe('P4 search by signals', () => {
  const vps = titled('VP Sales').filter(verifiable)
  const hiring = (p: FakePerson) => Boolean(companyById(p.companyId)!.hiring)

  test('with Hiring ticked, a job-title search shows and charges for only people at companies hiring, and a keyword narrows them', async ({ page, problems, host }) => {
    test.setTimeout(6 * 60_000)
    const atHiring = vps.filter(hiring)
    // Some VPs of Sales work where nobody's hiring (Bramblefield has only raised funding), so there's something to leave out.
    expect(atHiring.length).toBeGreaterThan(0)
    expect(atHiring.length).toBeLessThan(vps.length)
    const before = await usage(page, 'Prospects found')

    await searchPeople(page, { titles: ['VP Sales'], signals: ['Hiring'], includeContacts: true })
    expect(names(await shown(page))).toEqual(names(atHiring))
    for (const p of atHiring) await expect(rowOf(page, p).getByText('Hiring', { exact: true })).toBeVisible()
    // The host searches by job title alone; whether each employer is hiring was asked of it after.
    const asked = (await host.log('/v2/linkedin/people/searches')).filter((c) => c.method === 'POST')
    expect(asked.at(-1)?.body?.titles).toEqual(['VP Sales'])
    const checked = (await host.log('/v1/company-signals')).flatMap((c) => (c.body?.companies ?? []) as Array<{ domain: string | null }>)
    expect(checked.map((c) => c.domain)).toEqual(expect.arrayContaining(['bramblefield.test', 'lanternfish.test']))
    // A credit for each person shown, and none for those left out (searchPeople ran it twice: once carrying on, once from the top).
    const after = await usage(page, 'Prospects found')
    expect(after - before).toBeLessThanOrEqual(2 * atHiring.length)
    expect((after - before) % atHiring.length).toBe(0)

    // A keyword keeps those whose job, employer or its industry has it: Copperwick is a software company, Saltmarsh makes machinery.
    await searchPeople(page, { titles: ['VP Sales'], signals: ['Hiring'], keyword: 'software', includeContacts: true })
    const software = atHiring.filter((p) => companyById(p.companyId)!.industry.includes('Software'))
    expect(software.length).toBeGreaterThan(0)
    expect(software.length).toBeLessThan(atHiring.length)
    expect(names(await shown(page))).toEqual(names(software))
    expect(problems()).toEqual([])
  })
})

test.describe('P2 reveal an email', () => {
  test('finds exactly the verified address, and counts one lookup', async ({ page, problems, host }) => {
    test.setTimeout(4 * 60_000)
    // Nobody saves her, so she's never left out as an existing contact.
    const target = person('farah-tindall-saltmarsh-robotics')
    const address = realAddress(target)!
    const before = await emailLookups(page)

    await searchPeople(page, { titles: [target.title] })
    const row = rowOf(page, target)
    await row.getByRole('button', { name: 'Reveal email' }).click()
    const email = row.locator('td').nth(6)
    await expect(email.getByText('Verified', { exact: true })).toBeVisible({ timeout: 120_000 })
    expect((await email.innerText()).match(/[^\s@]+@[^\s@]+/g)).toEqual([address])
    // The address was checked with the host's verification, and verification said it's real.
    expect((await host.log('/v1/check_email')).some((c) => c.body?.to_email === address)).toBe(true)
    expect(verdict(address)).toBe('safe')

    expect(await emailLookups(page)).toBe(before + 1)
    expect(problems()).toEqual([])
  })

  test("at a company with no mail server, or one that accepts every address, it says it can't verify", async ({ page, problems }) => {
    test.setTimeout(4 * 60_000)
    const noMail = person('oona-dunmore-thistledown-finance')
    const catchAll = person('bram-kettle-quillmoor')
    // By default they're left out of results altogether; shown, they're marked.
    await hideUnverifiable(page, false)
    try {
      await searchPeople(page, { titles: ['Chief Technology Officer'], includeContacts: true })

      const atCatchAll = rowOf(page, catchAll).locator('td').nth(6)
      await expect(atCatchAll.getByText('Unverifiable', { exact: true })).toBeVisible()
      await expect(atCatchAll.locator('[title]').first()).toHaveAttribute('title', /accepts every address, so no email there can be verified/)
      await expect(atCatchAll.getByRole('button', { name: 'Reveal email' })).toHaveCount(0)

      const atNoMail = rowOf(page, noMail).locator('td').nth(6)
      await atNoMail.getByRole('button', { name: 'Reveal email' }).click()
      await expect(atNoMail.getByText("Unable to verify email. This didn't use a reveal.")).toBeVisible({ timeout: 120_000 })
      await expect(atNoMail).not.toContainText('@')
      expect(problems()).toEqual([])
    } finally {
      await hideUnverifiable(page, true)
    }
  })
})

test.describe('P3 save people to a list', () => {
  test('they become contacts on the list; an opted-out address is not saved; the host gets only verified, saved people', async ({ page, browser, problems, host }) => {
    test.setTimeout(5 * 60_000)
    // Someone opts out by their work email alone. Search can't tell who that is from a
    // name and profile, so they're still found; it's saving them that must be refused.
    const optedOut = person('ivo-ashby-saltmarsh-robotics')
    await optOut(browser, realAddress(optedOut)!)

    const growthLeads = titled('Growth Lead').filter(verifiable)
    const savable = growthLeads.filter((p) => p !== optedOut)
    expect(growthLeads).toContain(optedOut)
    await searchPeople(page, { titles: ['Growth Lead'], includeContacts: true })
    expect(names(await shown(page))).toEqual(names(growthLeads))

    await page.getByRole('checkbox', { name: 'Select all on this page' }).check()
    const { dialog, listName } = await saveToNewList(page, growthLeads.length, 'P3 growth leads')
    // Saved the first time; on a later run they're already contacts, and saving adds them to the list.
    const newlySaved: FakePerson[] = []
    for (const p of savable) {
      const line = outcomeOf(dialog, p)
      await expect(line).toContainText(realAddress(p)!)
      await expect(line).toContainText(/Saved|Already a contact, added to list/)
      if (!(await line.innerText()).includes('Already a contact')) newlySaved.push(p)
    }
    const refused = outcomeOf(dialog, optedOut)
    await expect(refused).toContainText('Opted out, not saved')
    await expect(refused).not.toContainText('@')
    await dialog.getByRole('button', { name: 'Done' }).click()

    // The list holds exactly the savable people, by the addresses their companies really use.
    await page.goto('/marketing/lists')
    await page.getByRole('link').filter({ hasText: listName }).click()
    const main = page.getByRole('main')
    await expect(main.getByText(`Viewing ${savable.length} contacts in this list.`)).toBeVisible()
    for (const p of savable) await expect(main.getByRole('cell', { name: realAddress(p)!, exact: true })).toBeVisible()
    await expect(main.getByText(realAddress(optedOut)!)).toHaveCount(0)

    // They're contacts; the opted-out address isn't one.
    await page.goto('/marketing/contacts')
    const find = page.getByPlaceholder('Search...')
    await find.fill(realAddress(savable[0])!)
    await expect(page.getByRole('main').getByRole('cell', { name: realAddress(savable[0])!, exact: true })).toBeVisible()
    await find.fill(realAddress(optedOut)!)
    await expect(page.getByText(/^0 of \d[\d,]* contacts$/)).toBeVisible()

    // The host's shared database is sent each newly saved person, and only ever verified, saved people.
    const contributed = async () => (await host.log('/v1/pool/contribute')).flatMap((c) => (c.body?.people ?? []) as Array<{ email: string; emailStatus: string }>)
    await expect.poll(async () => (await contributed()).map((c) => c.email)).toEqual(expect.arrayContaining(newlySaved.map((p) => realAddress(p)!)))
    const sent = await contributed()
    for (const c of sent) {
      expect(c.emailStatus).toBe('verified')
      expect(verdict(c.email), `${c.email} was sent, but verification wouldn't call it real`).toBe('safe')
    }
    expect(sent.map((c) => c.email)).not.toContain(realAddress(optedOut))
    expect(problems()).toEqual([])
  })

  test("people whose email can't be verified aren't saved, or sent to the host", async ({ page, problems, host }) => {
    test.setTimeout(5 * 60_000)
    const unverifiable = titled('Founder').filter((p) => !verifiable(p))
    expect(unverifiable.length).toBeGreaterThan(0)
    await hideUnverifiable(page, false)
    try {
      await searchPeople(page, { titles: ['Founder'], includeContacts: true })
      expect(names(await shown(page))).toEqual(names(titled('Founder')))
      for (const p of unverifiable) await rowOf(page, p).getByRole('checkbox').check()
      const { dialog, listName } = await saveToNewList(page, unverifiable.length, 'P3 unverifiable')
      for (const p of unverifiable) {
        const line = outcomeOf(dialog, p)
        await expect(line).toContainText(/No email found|Couldn't verify an email/)
        await expect(line).not.toContainText('@')
      }
      await dialog.getByRole('button', { name: 'Done' }).click()

      await page.goto('/marketing/lists')
      await page.getByRole('link').filter({ hasText: listName }).click()
      await expect(page.getByRole('main').getByText('Viewing 0 contacts in this list.')).toBeVisible()
      const domains = new Set(unverifiable.map((p) => companyById(p.companyId)!.domain))
      const sent = (await host.log('/v1/pool/contribute')).flatMap((c) => (c.body?.people ?? []) as Array<{ email: string }>)
      expect(sent.filter((c) => domains.has(c.email.split('@')[1]))).toEqual([])
      expect(problems()).toEqual([])
    } finally {
      await hideUnverifiable(page, true)
    }
  })

  test('contacts saved from search are marked as found by prospect search', async ({ page, problems }) => {
    test.fail(
      true,
      'A hosted copy saves search results with source "web" (verifiedPeopleSource.ts mapPerson), and the Contacts page\'s "Found by" filter labels only "socialfetch" as "Prospect search" (contactFilters.ts SOURCE_LABELS), so these contacts show as found by "Web".',
    )
    test.setTimeout(4 * 60_000)
    const target = person('cora-orme-copperwick-analytics')
    await searchPeople(page, { titles: [target.title], includeContacts: true })
    await rowOf(page, target).getByRole('checkbox').check()
    const { dialog } = await saveToNewList(page, 1, 'P3 source')
    await expect(outcomeOf(dialog, target)).toContainText(/Saved|Already a contact, added to list/)
    await dialog.getByRole('button', { name: 'Done' }).click()

    await page.goto('/marketing/contacts')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Add a filter' }).click()
    await page.getByRole('menuitem', { name: 'Found by' }).click()
    await page.getByRole('combobox', { name: 'Found by value' }).click()
    // The app's own name for people found by prospect search.
    const choices = page.getByRole('listbox', { name: 'Found by value' })
    await expect(choices.getByRole('option', { name: 'Choose…' })).toBeVisible()
    await expect(choices.getByRole('option', { name: 'Prospect search', exact: true })).toBeVisible()
    await choices.getByRole('option', { name: 'Prospect search', exact: true }).click()
    await expect(page.getByRole('main').getByRole('cell', { name: realAddress(target)!, exact: true })).toBeVisible()
    expect(problems()).toEqual([])
  })
})
