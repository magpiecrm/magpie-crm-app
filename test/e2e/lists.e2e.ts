// L1 (test/JOURNEYS.md): a fixed list, made by hand, filled by hand, and one taken off it.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { unique } from './helpers'

/** A made-up address at a .test domain, unique to this run. */
const address = (label: string) => `${unique(label).replace(/\s+/g, '-')}@lists.test`

/** Contacts → Create a contact, ticking the list to put them on. */
async function createContactOnList(page: Page, email: string, firstName: string, list: string) {
  await page.goto('/marketing/contacts')
  await page.getByRole('button', { name: 'Create a contact' }).click()
  await page.getByPlaceholder('Enter the FIRSTNAME').fill(firstName)
  await page.getByPlaceholder('Enter the email address').fill(email)
  await page.getByRole('checkbox', { name: list }).check()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Contact created')).toBeVisible()
}

test('a list is made, filled with contacts, and one is taken off it', async ({ page, problems }) => {
  const list = unique('L1 list')
  const people = [
    { email: address('l1-lena'), name: 'Lena' },
    { email: address('l1-luca'), name: 'Luca' },
    { email: address('l1-lior'), name: 'Lior' },
  ]

  await page.goto('/marketing/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  const dialog = page.getByRole('dialog', { name: 'New list' })
  await dialog.getByPlaceholder('e.g. Newsletter subscribers').fill(list)
  await dialog.getByRole('button', { name: 'Create list' }).click()
  await expect(page.getByText('List created')).toBeVisible()
  const card = page.getByRole('link').filter({ hasText: list })
  await expect(card).toContainText('0 contacts')

  for (const p of people) await createContactOnList(page, p.email, p.name, list)

  // The list holds the three of them.
  await page.goto('/marketing/lists')
  await expect(card).toContainText('3 contacts')
  await card.click()
  await expect(page.getByRole('heading', { name: list, level: 1 })).toBeVisible()
  await expect(page.getByText('Viewing 3 contacts in this list.')).toBeVisible()
  const table = page.getByRole('table')
  for (const p of people) await expect(table.getByRole('row').filter({ hasText: p.email })).toHaveCount(1)

  // Taking one off asks first, then leaves the other two.
  const [gone, ...kept] = people
  await table.getByRole('button', { name: `Remove ${gone.email} from list` }).click()
  const confirm = page.getByRole('alertdialog', { name: `Remove ${gone.email} from this list?` })
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText('Viewing 2 contacts in this list.')).toBeVisible()
  await expect(table.getByRole('row').filter({ hasText: gone.email })).toHaveCount(0)
  for (const p of kept) await expect(table.getByRole('row').filter({ hasText: p.email })).toHaveCount(1)

  // Still so after a reload, and on the Lists page.
  await page.reload()
  await expect(page.getByText('Viewing 2 contacts in this list.')).toBeVisible()
  await page.goto('/marketing/lists')
  await expect(card).toContainText('2 contacts')

  // They're off the list, not out of Contacts.
  await page.goto(`/marketing/contacts?contact=${encodeURIComponent(gone.email)}`)
  await expect(page.getByRole('heading', { name: gone.name, level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Lists' })).toContainText('Not on any list.')

  expect(problems()).toEqual([])
})
