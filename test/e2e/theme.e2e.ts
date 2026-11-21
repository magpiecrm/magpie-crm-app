// The theme (test/JOURNEYS.md): it follows the system's until one is picked with the
// toggle, and then the pick lasts. Neither makes the browser redraw the page the
// server sent (React hydration error #418), which `problems` would catch.
import { expect, test } from './fixtures'

test('the theme follows the system until one is picked, and the pick lasts', async ({ page, problems }) => {
  const html = page.locator('html')
  await page.goto('/marketing/contacts')
  await page.evaluate(() => localStorage.removeItem('theme'))

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(html).toHaveClass(/\bdark\b/)
  await page.waitForLoadState('networkidle')
  expect(await page.evaluate(() => localStorage.getItem('theme')), 'nothing picked, so nothing saved').toBeNull()

  // The system's changes, and the page follows it there and then.
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveClass(/\blight\b/)
  await page.reload()
  await expect(html).toHaveClass(/\blight\b/)

  // Picked: it stays, whatever the system's.
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await expect(html).toHaveClass(/\bdark\b/)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(html).toHaveClass(/\bdark\b/)
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await expect(html).toHaveClass(/\blight\b/)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(html).toHaveClass(/\blight\b/)

  expect(problems()).toEqual([])
})
