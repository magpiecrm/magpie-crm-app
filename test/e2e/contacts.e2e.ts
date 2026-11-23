// C1, C3 and C5 (test/JOURNEYS.md): contacts added by hand and by import, what a tick acts on, and a contact's page.
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { unique } from './helpers'

/** A made-up address at a .test domain, unique to this run. */
const address = (label: string) => `${unique(label).replace(/\s+/g, '-')}@contacts.test`

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Contacts → Create a contact, as someone fills it in by hand. */
async function createContact(page: Page, contact: { email: string; firstName?: string; lastName?: string; company?: string; jobTitle?: string }) {
  await page.goto('/marketing/contacts')
  await page.getByRole('button', { name: 'Create a contact' }).click()
  if (contact.firstName) await page.getByPlaceholder('Enter the FIRSTNAME').fill(contact.firstName)
  if (contact.lastName) await page.getByPlaceholder('Enter the LASTNAME').fill(contact.lastName)
  if (contact.company) await page.getByPlaceholder('Enter the company name').fill(contact.company)
  if (contact.jobTitle) await page.getByPlaceholder('Enter the job title').fill(contact.jobTitle)
  await page.getByPlaceholder('Enter the email address').fill(contact.email)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Contact created')).toBeVisible()
}

/** The contacts table, searched down to one address. */
async function findInTable(page: Page, email: string) {
  await page.goto('/marketing/contacts')
  await page.getByPlaceholder('Search...').fill(email)
  const row = page.getByRole('table').getByRole('row').filter({ hasText: email })
  await expect(row).toHaveCount(1)
  return row
}

/** The total under the toolbar ("12 contacts"), once the page has loaded. */
async function contactCount(page: Page) {
  await page.goto('/marketing/contacts')
  const count = page.getByText(/^[\d,]+ contacts?$/)
  await expect(count).toBeVisible()
  return Number((await count.innerText()).replace(/\D/g, ''))
}

/** The side panel of a contact's page: their details, custom fields, company, deals and lists. */
const aboutPanel = (page: Page) => page.getByRole('complementary', { name: 'About this contact' })

/** A contact's page, and its side panel. */
async function openContact(page: Page, email: string) {
  await page.goto(`/marketing/contacts?contact=${encodeURIComponent(email)}`)
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible()
  return aboutPanel(page)
}

/** One labelled value in the side panel (a label, then its value). */
const info = (panel: ReturnType<Page['locator']>, label: string) => panel.locator('div:has(> dt)').filter({ has: panel.page().locator('dt').getByText(label, { exact: true }) })

/** Settings → Contact fields: deletes every field whose label starts with `prefix` (this run's, and any a failed run left). */
async function deleteFields(page: Page, prefix: string) {
  await page.goto('/settings?tab=fields')
  await page.waitForLoadState('networkidle')
  const buttons = page.getByRole('main').getByRole('button', { name: new RegExp(`^Delete ${escape(prefix)}`) })
  for (let n = await buttons.count(); n > 0; n--) {
    await buttons.first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete field' }).click()
    await expect(buttons).toHaveCount(n - 1)
  }
}

test('a contact added by hand is edited inline in the table and shows on their page', async ({ page, problems }) => {
  await deleteFields(page, 'C1 tier')
  const email = address('c1')
  await createContact(page, { email, firstName: 'Cora', lastName: 'Inline', company: 'Copperwick', jobTitle: 'Head of Ops' })

  // A column made from the table: a new field, shown at once.
  const field = unique('C1 tier')
  let row = await findInTable(page, email)
  await expect(row).toContainText('Cora Inline')
  await page.getByRole('button', { name: 'Add column' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a column' })
  await dialog.getByPlaceholder('e.g. Industry').fill(field)
  await dialog.getByRole('button', { name: 'Add column' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('columnheader', { name: field })).toBeVisible()

  // Edited in its cell: click, type, Enter.
  await row.getByRole('button', { name: `Edit ${field} for ${email}` }).click()
  await page.getByRole('textbox', { name: `${field} for ${email}`, exact: true }).fill('Gold')
  await page.keyboard.press('Enter')
  await expect(row.getByRole('button', { name: `Edit ${field} for ${email}` })).toHaveText('Gold')

  // Kept: still there after a reload…
  row = await findInTable(page, email)
  await expect(row.getByRole('button', { name: `Edit ${field} for ${email}` })).toHaveText('Gold')

  // …and on their page, with what was typed by hand.
  await row.getByText('Cora Inline').click()
  await expect(page.getByRole('heading', { name: 'Cora Inline', level: 1 })).toBeVisible()
  const panel = aboutPanel(page)
  await expect(panel).toContainText('Copperwick')
  await expect(info(panel, 'Job title')).toContainText('Head of Ops')
  await expect(info(panel, field)).toContainText('Gold')

  await deleteFields(page, 'C1 tier')
  expect(problems()).toEqual([])
})

test('a contact’s page takes a note, a task ticked off from its summary, and shows their company', async ({ page, problems }) => {
  const email = address('c5')
  await createContact(page, { email, firstName: 'Nia', lastName: 'Record', company: 'Bramblefield', jobTitle: 'Head of Ops' })
  const panel = await openContact(page, email)

  // Who they are, at the top; their company in its own section.
  await expect(page.getByRole('heading', { name: 'Nia Record', level: 1 })).toBeVisible()
  await expect(page.getByText('Head of Ops at Bramblefield')).toBeVisible()
  await expect(panel).toContainText('Bramblefield')

  // A note, from the header's Note button, shows in the activity.
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.getByRole('textbox', { name: /^Note about/ }).fill('Asked for the security pack.')
  await page.getByRole('button', { name: 'Save note' }).click()
  const note = page.getByRole('listitem').filter({ hasText: 'Asked for the security pack.' })
  await expect(note).toBeVisible()

  // A task, added from the Tasks section, becomes the next step, and is ticked off from there.
  const tasks = page.getByRole('region', { name: 'Tasks' })
  await tasks.getByRole('button', { name: 'Add task' }).click()
  await tasks.getByRole('textbox', { name: 'New task' }).fill('Send the security pack')
  await tasks.getByRole('button', { name: 'Add task' }).click()
  await expect(tasks.getByText('Send the security pack')).toBeVisible()
  const tick = page.getByRole('button', { name: 'Mark “Send the security pack” done' })
  await tick.click()
  await expect(tick).toHaveCount(0)

  // The note goes, after asking.
  await note.getByRole('button', { name: 'Note actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete note' }).click()
  await expect(note).toHaveCount(0)

  expect(problems()).toEqual([])
})

/** Contacts → Import from a file: a CSV written for this run, uploaded, then its parsed grid shown for mapping. */
async function uploadCsv(page: Page, rows: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-import-'))
  const csv = join(dir, 'contacts.csv')
  writeFileSync(csv, rows.join('\n'))
  try {
    await page.goto('/marketing/contacts/import')
    await page.getByRole('heading', { name: 'Import from a file' }).click()
    await page.locator('input[type="file"]').setInputFiles(csv)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  await expect(page.getByText(`Parsed ${rows.length} rows successfully`)).toBeVisible()
}

/** Lists → New list. */
async function createList(page: Page, name: string) {
  await page.goto('/marketing/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder('e.g. Newsletter subscribers').fill(name)
  await page.getByRole('button', { name: 'Create list' }).click()
  await expect(page.getByText('List created')).toBeVisible()
}

/** The import's target list, then Confirm Import, which goes back to Contacts. */
async function confirmImport(page: Page, list: string) {
  await page.getByRole('combobox').filter({ hasText: '-- Choose list --' }).click()
  await page.getByRole('option', { name: `${list} (ID:` }).click()
  await page.getByRole('button', { name: 'Confirm Import' }).click()
  await expect(page).toHaveURL(/\/marketing\/contacts$/)
}

test('a CSV import maps its columns, merges a duplicate, counts right and makes a new field', async ({ page, problems }) => {
  await deleteFields(page, 'C3 tier')
  const ada = address('c3-ada')
  const bea = address('c3-bea')
  const xena = address('c3-xena')
  const field = unique('C3 tier')
  const list = unique('C3 import')

  // Someone already there, whom the import adds to without clearing what they had.
  await createContact(page, { email: xena, firstName: 'Xena', jobTitle: 'Founder' })
  await createList(page, list)
  const before = await contactCount(page)

  // A header row, the built-ins, a column no field has yet, Ada twice (in other case, bringing a job
  // title the first row lacked, blanks elsewhere) and Xena, who's already a contact.
  await uploadCsv(page, [
    `Email,First name,Last name,Company,Job title,${field}`,
    `${ada},Ada,Lovelace,Copperwick,,Gold`,
    `${bea},Bea,Smith,Bramblefield,Buyer,Silver`,
    `${ada.toUpperCase()},,,,CTO,`,
    `${xena},,,Quillmoor,,Bronze`,
  ])

  // The header row is read as headers and each built-in column found by its name.
  const column = (n: number) => page.getByRole('columnheader', { name: `Column ${n}` }).getByRole('combobox')
  await expect(page.getByLabel('First row contains headers')).toBeChecked()
  await expect(column(1)).toHaveText('Email')
  await expect(column(2)).toHaveText('First Name')
  await expect(column(3)).toHaveText('Last Name')
  await expect(column(4)).toHaveText('Company')
  await expect(column(5)).toHaveText('Job Title')
  await expect(column(6)).toHaveText('Do not import (Skip)')

  // The last column gets a field of its own, named from its header.
  await column(6).click()
  await page.getByRole('option', { name: 'Create a new field…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New field' })
  await expect(dialog.getByPlaceholder('e.g. Industry')).toHaveValue(field)
  await dialog.getByRole('button', { name: 'Create field' }).click()
  await expect(dialog).toBeHidden()
  await expect(column(6)).toHaveText(field)
  await confirmImport(page, list)

  // Three people: Ada once, Bea, and Xena, who was already there. Two of them new.
  expect(await contactCount(page)).toBe(before + 2)
  await page.goto('/marketing/lists')
  await expect(page.getByRole('link').filter({ hasText: list })).toContainText('3 contacts')

  // The new field is a column on Contacts, filled from the file.
  let row = await findInTable(page, ada)
  await expect(page.getByRole('columnheader', { name: field })).toBeVisible()
  await expect(row.getByRole('button', { name: `Edit ${field} for ${ada}` })).toHaveText('Gold')
  row = await findInTable(page, bea)
  await expect(row.getByRole('button', { name: `Edit ${field} for ${bea}` })).toHaveText('Silver')

  // Ada's two rows made one contact: the second row's job title added, its blanks clearing nothing.
  let panel = await openContact(page, ada)
  await expect(page.getByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeVisible()
  await expect(panel).toContainText('Copperwick')
  await expect(info(panel, 'Job title')).toContainText('CTO')
  await expect(info(panel, field)).toContainText('Gold')

  // Xena keeps her name and job title, and gains the company and tier.
  panel = await openContact(page, xena)
  await expect(page.getByRole('heading', { name: 'Xena', level: 1 })).toBeVisible()
  await expect(info(panel, 'Job title')).toContainText('Founder')
  await expect(panel).toContainText('Quillmoor')
  await expect(info(panel, field)).toContainText('Bronze')
  await expect(page.getByText(list, { exact: true }).first()).toBeVisible()

  // The field is a real one, listed in Settings.
  await page.goto('/settings?tab=fields')
  await expect(page.getByRole('main').getByText(field, { exact: true })).toBeVisible()

  await deleteFields(page, 'C3 tier')
  expect(problems()).toEqual([])
})

test('an import says how many people it brought in, counting a duplicate once', async ({ page, problems }) => {
  test.fail(true, 'addContactsToList (src/server/emailService.ts:214) counts every row, so a file with one person twice says "Imported 2 contacts"')
  const dup = address('c3-dup')
  const list = unique('C3 count')
  await createList(page, list)
  await uploadCsv(page, ['Email,First name', `${dup},Dana`, `${dup.toUpperCase()},Dana`])
  await confirmImport(page, list)
  await expect(page.getByText(/^Imported \d+ contacts?$/)).toHaveText('Imported 1 contact')
  expect(problems()).toEqual([])
})

test('Delete and Add to sequence act only on the ticked contacts in view', async ({ page, problems }) => {
  const run = unique('C1 tick').replace(/\s+/g, '-').toLowerCase()
  const list = unique('C1 tick list')
  const onList = `${run}-on-list@contacts.test`
  const [ada, ben] = [`${run}-ada@contacts.test`, `${run}-ben@contacts.test`]

  await page.goto('/marketing/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  const dialog = page.getByRole('dialog', { name: 'New list' })
  await dialog.getByPlaceholder('e.g. Newsletter subscribers').fill(list)
  await dialog.getByRole('button', { name: 'Create list' }).click()
  await expect(page.getByText('List created')).toBeVisible()

  await page.goto('/marketing/contacts')
  await page.getByRole('button', { name: 'Create a contact' }).click()
  await page.getByPlaceholder('Enter the email address').fill(onList)
  await page.getByRole('checkbox', { name: list }).check()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Contact created')).toBeVisible()
  await createContact(page, { email: ada, firstName: 'Ada' })
  await createContact(page, { email: ben, firstName: 'Ben' })

  // Tick Ada and Ben, found by a search for this run.
  await page.goto('/marketing/contacts')
  const search = page.getByPlaceholder('Search...')
  await search.fill(`${run}-`)
  await page.getByRole('checkbox', { name: `Select ${ada}` }).check()
  await page.getByRole('checkbox', { name: `Select ${ben}` }).check()
  await expect(page.getByRole('button', { name: 'Delete selected (2)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to sequence (2)' })).toBeVisible()

  // A search that hides Ben leaves only Ada to act on.
  await search.fill(ada)
  await expect(page.getByRole('button', { name: 'Delete selected (1)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to sequence (1)' })).toBeVisible()

  // Back in view, Ben counts again.
  await search.fill(`${run}-`)
  await expect(page.getByRole('button', { name: 'Delete selected (2)' })).toBeVisible()

  // Choosing a list starts the selection over: nothing to delete there.
  await search.fill('')
  await page.getByRole('button', { name: 'All contacts' }).first().click()
  await page.getByRole('button', { name: list }).click()
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: onList })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Delete selected/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Add to sequence/ })).toHaveCount(0)

  // Back on All contacts, nothing is ticked any more.
  await page.getByRole('button', { name: list }).first().click()
  await page.getByRole('button', { name: 'All contacts', exact: true }).click()
  await search.fill(`${run}-`)
  await expect(page.getByRole('checkbox', { name: `Select ${ada}` })).not.toBeChecked()

  // Tick Ada and Ben again, hide Ben, delete: only Ada goes.
  await page.getByRole('checkbox', { name: `Select ${ada}` }).check()
  await page.getByRole('checkbox', { name: `Select ${ben}` }).check()
  await search.fill(ada)
  await page.getByRole('button', { name: 'Delete selected (1)' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete this contact?' })
  await confirm.getByRole('button', { name: 'Delete contact' }).click()
  await expect(page.getByText('Contacts deleted')).toBeVisible()
  await search.fill(`${run}-`)
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows.filter({ hasText: ada })).toHaveCount(0)
  await expect(rows.filter({ hasText: ben })).toHaveCount(1)
  await expect(rows.filter({ hasText: onList })).toHaveCount(1)

  expect(problems()).toEqual([])
})
