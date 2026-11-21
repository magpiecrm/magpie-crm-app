// Steps more than one journey needs, done through the UI as a customer would.
// Each is safe to repeat: journeys share one workspace and may run in any order.
import { expect, type Page } from '@playwright/test'
import { ensureFolders } from '../stack/mail'
import { readState } from '../stack/state'

/** The workspace's one sender, on a domain the stand-in host makes ready. */
export const SENDER = { name: 'Sam Seller', email: 'sam@acme-sends.test', domain: 'acme-sends.test' }

/** Settings → Sending: the sender's domain, added and ready (hosted: the stand-in host's sending domains). */
export async function ensureSendingDomain(page: Page) {
  await page.goto('/settings?tab=sending')
  const main = page.getByRole('main')
  // The page says "none yet" while it's still loading, so wait for it to settle before asking.
  await page.waitForLoadState('networkidle')
  // Once anything's been sent it shows twice (its row, and under Reputation).
  if (!(await main.getByText(SENDER.domain, { exact: true }).first().isVisible())) {
    await main.getByPlaceholder('acme.com').fill(SENDER.domain)
    await main.getByRole('button', { name: 'Add domain' }).click()
  }
  await expect(main.getByText('Ready to send')).toBeVisible()
}

/** Settings → Mailboxes: the sender, with its inbox connected to the stack's GreenMail (no TLS). */
export async function ensureSender(page: Page) {
  await ensureSendingDomain(page)
  // A real inbox has a Sent folder, where the app files a copy of each answer it sends.
  await ensureFolders(SENDER.email)
  await page.goto('/settings?tab=senders')
  const main = page.getByRole('main')
  await page.waitForLoadState('networkidle')
  // Its Edit and Delete buttons only show on hover, so ask whether they exist, not whether they show.
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

/** A unique, recognisable string for things a journey makes, so reruns don't collide. */
export const unique = (label: string) => `${label} ${Date.now().toString(36)}`
