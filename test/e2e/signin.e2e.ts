// S1: signing in and out (test/JOURNEYS.md).
import { expect, test } from './fixtures'
import { readState } from '../stack/state'

test.use({ storageState: { cookies: [], origins: [] } })

test('a wrong password is refused and the right one opens the workspace', async ({ page, problems }) => {
  const { login } = readState()
  await page.goto('/login')
  await page.locator('#email-input').fill(login.email)
  await page.locator('#password-input').fill('not-the-password')
  await page.locator('#login-submit-button').click()
  await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)

  await page.locator('#password-input').fill(login.password)
  await page.locator('#login-submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
  // A wrong password answers 401, which the browser logs as a failed resource: expected here.
  expect(problems().filter((p) => !/401|Unauthorized/.test(p))).toEqual([])
})

test('a page needs signing in', async ({ page }) => {
  await page.goto('/marketing/contacts')
  await expect(page).toHaveURL(/\/login/)
})
