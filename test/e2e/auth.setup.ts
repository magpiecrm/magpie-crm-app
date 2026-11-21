// Signs in once with the stack's throwaway login and keeps the session for every journey.
import { expect, test as setup } from '@playwright/test'
import { join } from 'path'
import { readState, stackDir } from '../stack/state'

setup('sign in', async ({ page }) => {
  const { login } = readState()
  await page.goto('/login')
  await page.locator('#email-input').fill(login.email)
  await page.locator('#password-input').fill(login.password)
  await page.locator('#login-submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
  await page.context().storageState({ path: join(stackDir(), 'auth.json') })
})
